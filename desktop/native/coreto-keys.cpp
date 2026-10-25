// Vigia o teclado no Windows e avisa quando uma combinação de atalho é apertada, com qualquer programa em
// primeiro plano: um jogo em tela cheia, por exemplo. É o que o Electron (`globalShortcut`, que usa
// RegisterHotKey) não consegue: o Windows não entrega esses atalhos a quem está atrás de um jogo, e uma tecla sozinha
// (como "V") nem pode ser registrada. Aqui as teclas vêm do Raw Input com RIDEV_INPUTSINK, que entrega o teclado
// a este programa mesmo sem foco. Não instala hook nem injeta nada em outros programas, e não engole as teclas:
// o jogo continua recebendo tudo, como no Discord.
//
// Conversa com o Coreto por linhas de texto:
//   entrada:  set <ação> <combinação>   define (ou troca) o atalho de uma ação; combinação vazia remove
//             clear                     remove todos
//   saída:    ready                     pronto para vigiar
//             fire <ação>               o atalho foi apertado
// Uma combinação são teclas separadas por "+"; cada tecla é uma lista de códigos de varredura (scan codes) em
// hexadecimal separados por "|", qualquer um serve (ex.: Ctrl = "1D|E01D"; o prefixo E0 marca as teclas estendidas).
// O atalho dispara quando todas as teclas dele estão apertadas (podem haver outras, como as de andar num jogo) e
// uma delas acabou de ser apertada. Havendo mais de um atalho satisfeito, vale o que tem mais teclas.
// Para quando a entrada padrão fecha (o app fechou). Em caso de erro escreve "erro: ..." na saída de erro.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <vector>

#pragma comment(lib, "user32.lib")

namespace {

using KeyId = uint16_t;  // código de varredura; 0xE000 | código nas teclas estendidas

struct Bind {
  std::vector<std::vector<KeyId>> keys;  // cada tecla do atalho, com os códigos que a representam
  bool satisfied = false;
};

std::mutex g_lock;
std::map<std::string, Bind> g_binds;
std::map<KeyId, DWORD> g_down;  // teclas apertadas agora e quando chegaram (GetTickCount)
HWND g_window = nullptr;

constexpr UINT_PTR kPruneTimer = 1;
constexpr UINT kPruneMs = 500;
/** Uma tecla recém-chegada não é conferida contra o estado do sistema (ele pode ainda não ter atualizado). */
constexpr DWORD kPruneGraceMs = 150;

void Say(const std::string& line) {
  fwrite(line.data(), 1, line.size(), stdout);
  fputc('\n', stdout);
  if (fflush(stdout) != 0) PostMessageW(g_window, WM_CLOSE, 0, 0);  // ninguém lê mais: o app fechou
}

bool ParseKey(const std::string& text, std::vector<KeyId>* out) {
  std::stringstream alternatives(text);
  std::string item;
  while (std::getline(alternatives, item, '|')) {
    if (item.empty() || item.size() > 4) return false;
    char* end = nullptr;
    unsigned long value = strtoul(item.c_str(), &end, 16);
    if (*end != '\0' || value == 0 || value > 0xFFFF) return false;
    out->push_back(static_cast<KeyId>(value));
  }
  return !out->empty();
}

bool ParseCombo(const std::string& text, Bind* out) {
  std::stringstream keys(text);
  std::string item;
  while (std::getline(keys, item, '+')) {
    std::vector<KeyId> key;
    if (!ParseKey(item, &key)) return false;
    out->keys.push_back(key);
  }
  return !out->keys.empty() && out->keys.size() <= 8;
}

bool IsDown(const std::vector<KeyId>& alternatives) {
  for (KeyId id : alternatives) {
    if (g_down.count(id)) return true;
  }
  return false;
}

/** Avisa os atalhos que acabaram de ficar completos; só o de mais teclas, se houver vários. */
void Evaluate(bool keyWentDown) {
  std::vector<std::pair<size_t, std::string>> fresh;
  size_t biggest = 0;
  for (auto& [action, bind] : g_binds) {
    bool all = true;
    for (const auto& key : bind.keys) {
      if (!IsDown(key)) {
        all = false;
        break;
      }
    }
    if (all) biggest = std::max(biggest, bind.keys.size());
    if (all && !bind.satisfied && keyWentDown) fresh.emplace_back(bind.keys.size(), action);
    bind.satisfied = all;
  }
  for (const auto& [size, action] : fresh) {
    if (size == biggest) {
      Say("fire " + action);
      return;
    }
  }
}

void OnKey(const RAWKEYBOARD& key) {
  if (key.MakeCode == 0 || key.MakeCode == 0xFF) return;  // teclas "falsas" do Windows (overrun)
  if (key.Flags & RI_KEY_E1) return;                      // Pause: sequência especial, sem uso em atalhos
  KeyId id = static_cast<KeyId>((key.Flags & RI_KEY_E0 ? 0xE000 : 0) | (key.MakeCode & 0xFF));
  bool up = (key.Flags & RI_KEY_BREAK) != 0;

  std::lock_guard<std::mutex> guard(g_lock);
  if (up) {
    g_down.erase(id);
    Evaluate(false);
    return;
  }
  // Repetição automática chega como mais um "apertou" da mesma tecla: só a primeira conta.
  bool fresh = g_down.emplace(id, GetTickCount()).second;
  Evaluate(fresh);
}

/**
 * Se o Windows perdeu um "soltou" (travar a tela com Win+L, Ctrl+Alt+Del...), a tecla ficaria presa como apertada
 * e o atalho dela nunca mais dispararia. De tempos em tempos, tira as que o sistema diz que já estão soltas.
 */
void Prune() {
  std::lock_guard<std::mutex> guard(g_lock);
  DWORD now = GetTickCount();
  bool changed = false;
  for (auto it = g_down.begin(); it != g_down.end();) {
    UINT scan = (it->first & 0xFF) | ((it->first & 0xE000) ? 0xE000 : 0);
    UINT vk = MapVirtualKeyW(scan, MAPVK_VSC_TO_VK_EX);
    bool pressed = vk == 0 || (GetAsyncKeyState(static_cast<int>(vk)) & 0x8000) != 0;
    if (!pressed && now - it->second > kPruneGraceMs) {
      it = g_down.erase(it);
      changed = true;
    } else {
      ++it;
    }
  }
  if (changed) Evaluate(false);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
  switch (message) {
    case WM_INPUT: {
      UINT size = 0;
      GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, nullptr, &size, sizeof(RAWINPUTHEADER));
      if (size > 0 && size <= 1024) {
        alignas(RAWINPUT) BYTE buffer[1024];
        if (GetRawInputData(reinterpret_cast<HRAWINPUT>(lParam), RID_INPUT, buffer, &size, sizeof(RAWINPUTHEADER)) == size) {
          const RAWINPUT* input = reinterpret_cast<const RAWINPUT*>(buffer);
          if (input->header.dwType == RIM_TYPEKEYBOARD) OnKey(input->data.keyboard);
        }
      }
      return DefWindowProcW(window, message, wParam, lParam);  // o Windows pede que se chame para limpar a fila
    }
    case WM_TIMER:
      if (wParam == kPruneTimer) Prune();
      return 0;
    case WM_CLOSE:
      DestroyWindow(window);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(window, message, wParam, lParam);
  }
}

void HandleLine(const std::string& line) {
  std::stringstream words(line);
  std::string command;
  words >> command;
  std::lock_guard<std::mutex> guard(g_lock);
  if (command == "clear") {
    g_binds.clear();
  } else if (command == "set") {
    std::string action, combo;
    words >> action >> combo;
    if (action.empty() || action.size() > 32) return;
    Bind bind;
    if (combo.empty() || !ParseCombo(combo, &bind)) {
      g_binds.erase(action);
      return;
    }
    g_binds[action] = bind;
    Evaluate(false);  // o que já estiver apertado agora não dispara; só o próximo aperto
  }
}

/** Lê as ordens do Coreto até a entrada fechar. */
DWORD WINAPI ReadCommands(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  std::string pending;
  char chunk[256];
  DWORD read = 0;
  while (ReadFile(in, chunk, sizeof(chunk), &read, nullptr) && read > 0) {
    pending.append(chunk, read);
    size_t newline;
    while ((newline = pending.find('\n')) != std::string::npos) {
      std::string line = pending.substr(0, newline);
      pending.erase(0, newline + 1);
      if (!line.empty() && line.back() == '\r') line.pop_back();
      HandleLine(line);
    }
    if (pending.size() > 4096) pending.clear();
  }
  PostMessageW(g_window, WM_CLOSE, 0, 0);
  return 0;
}

}  // namespace

int main() {
  _setmode(_fileno(stdout), _O_BINARY);
  HINSTANCE instance = GetModuleHandleW(nullptr);
  WNDCLASSW windowClass = {};
  windowClass.lpfnWndProc = WindowProc;
  windowClass.hInstance = instance;
  windowClass.lpszClassName = L"CoretoKeys";
  if (!RegisterClassW(&windowClass)) {
    fprintf(stderr, "erro: RegisterClass (%lu)\n", GetLastError());
    return 2;
  }
  // Janela só para receber mensagens: não aparece em lugar nenhum.
  g_window = CreateWindowExW(0, windowClass.lpszClassName, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, instance, nullptr);
  if (!g_window) {
    fprintf(stderr, "erro: CreateWindow (%lu)\n", GetLastError());
    return 2;
  }
  RAWINPUTDEVICE keyboard = {};
  keyboard.usUsagePage = 0x01;  // controles genéricos
  keyboard.usUsage = 0x06;      // teclado
  keyboard.dwFlags = RIDEV_INPUTSINK;  // recebe também sem foco; sem RIDEV_NOLEGACY: as teclas seguem para o programa em foco
  keyboard.hwndTarget = g_window;
  if (!RegisterRawInputDevices(&keyboard, 1, sizeof(keyboard))) {
    fprintf(stderr, "erro: RegisterRawInputDevices (%lu)\n", GetLastError());
    return 2;
  }
  SetTimer(g_window, kPruneTimer, kPruneMs, nullptr);
  HANDLE reader = CreateThread(nullptr, 0, ReadCommands, nullptr, 0, nullptr);
  if (!reader) {
    fprintf(stderr, "erro: CreateThread (%lu)\n", GetLastError());
    return 2;
  }
  CloseHandle(reader);
  Say("ready");

  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  return 0;
}
