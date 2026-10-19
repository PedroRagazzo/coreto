// Captura o som de UM programa (ou da tela toda, menos o próprio Coreto) no Windows e escreve
// PCM cru na saída padrão: 16 bits, estéreo, 48 kHz. É o mesmo recurso que o Discord usa para
// "compartilhar a janela com som" (WASAPI, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK),
// que o Chromium/Electron não oferece. Baseado no exemplo ApplicationLoopback da Microsoft.
//
// Uso:
//   coreto-audio.exe window  <HWND>   som do programa dono da janela (e dos filhos dele)
//   coreto-audio.exe include <PID>    som desse processo e dos filhos
//   coreto-audio.exe exclude <PID>    som de tudo, menos desse processo e dos filhos
// Para quando a saída padrão fecha ou a entrada padrão chega ao fim (o app fechou).
// Em caso de erro escreve uma linha "erro: ..." na saída de erro e sai com código diferente de zero.

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <mmdeviceapi.h>
#include <fcntl.h>
#include <io.h>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cwchar>

#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "user32.lib")

static const DWORD kSampleRate = 48000;
static const WORD kChannels = 2;
static const WORD kBits = 16;

static int Fail(const char* what, HRESULT hr) {
  fprintf(stderr, "erro: %s (0x%08lx)\n", what, static_cast<unsigned long>(hr));
  return 2;
}

// Espera ActivateAudioInterfaceAsync terminar. IAgileObject deixa o Windows chamar de qualquer thread.
class ActivateHandler : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
 public:
  ActivateHandler() : event_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}
  ~ActivateHandler() { CloseHandle(event_); }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** out) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *out = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *out = static_cast<IAgileObject*>(this);
    } else {
      *out = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG n = --refs_;
    if (n == 0) delete this;
    return n;
  }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT activateHr = E_FAIL;
    IUnknown* unk = nullptr;
    HRESULT hr = op->GetActivateResult(&activateHr, &unk);
    result_ = FAILED(hr) ? hr : activateHr;
    if (SUCCEEDED(result_) && unk) unk->QueryInterface(IID_PPV_ARGS(&client_));
    if (unk) unk->Release();
    SetEvent(event_);
    return S_OK;
  }

  HANDLE event_;
  HRESULT result_ = E_PENDING;
  IAudioClient* client_ = nullptr;

 private:
  std::atomic<ULONG> refs_{1};
};

static std::atomic<bool> g_stop{false};

// O app (processo pai) segura nossa entrada padrão aberta; quando ele fecha, paramos.
static DWORD WINAPI WatchStdin(LPVOID) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char buf[64];
  DWORD n = 0;
  while (ReadFile(in, buf, sizeof buf, &n, nullptr) && n > 0) {
  }
  g_stop = true;
  return 0;
}

static bool WriteAll(HANDLE out, const BYTE* data, DWORD size) {
  while (size > 0) {
    DWORD written = 0;
    if (!WriteFile(out, data, size, &written, nullptr) || written == 0) return false;
    data += written;
    size -= written;
  }
  return true;
}

int wmain(int argc, wchar_t** argv) {
  if (argc != 3) {
    fprintf(stderr, "uso: coreto-audio window|include|exclude <HWND|PID>\n");
    return 1;
  }
  const wchar_t* mode = argv[1];
  wchar_t* end = nullptr;
  unsigned long long target = wcstoull(argv[2], &end, 10);
  if (end == argv[2] || *end != L'\0' || target == 0) {
    fprintf(stderr, "erro: número inválido\n");
    return 1;
  }

  DWORD pid = 0;
  PROCESS_LOOPBACK_MODE loopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  if (wcscmp(mode, L"window") == 0) {
    HWND hwnd = reinterpret_cast<HWND>(static_cast<UINT_PTR>(target));
    if (!IsWindow(hwnd) || GetWindowThreadProcessId(hwnd, &pid) == 0 || pid == 0) {
      fprintf(stderr, "erro: a janela não existe mais\n");
      return 1;
    }
  } else if (wcscmp(mode, L"include") == 0 || wcscmp(mode, L"exclude") == 0) {
    pid = static_cast<DWORD>(target);
    if (mode[0] == L'e') loopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  } else {
    fprintf(stderr, "erro: modo desconhecido\n");
    return 1;
  }

  _setmode(_fileno(stdout), _O_BINARY);
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return Fail("CoInitializeEx", hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  params.ProcessLoopbackParams.ProcessLoopbackMode = loopbackMode;
  PROPVARIANT activateProp = {};
  activateProp.vt = VT_BLOB;
  activateProp.blob.cbSize = sizeof params;
  activateProp.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivateHandler* handler = new ActivateHandler();
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &activateProp,
                                   handler, &op);
  if (FAILED(hr)) return Fail("ActivateAudioInterfaceAsync", hr);
  if (WaitForSingleObject(handler->event_, 10000) != WAIT_OBJECT_0) return Fail("tempo esgotado ao ativar", E_FAIL);
  if (FAILED(handler->result_) || !handler->client_) return Fail("ativar a captura do programa", handler->result_);
  IAudioClient* client = handler->client_;

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBits;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                          AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK, 0, 0, &format, nullptr);
  if (FAILED(hr)) return Fail("Initialize", hr);

  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(ready);
  if (FAILED(hr)) return Fail("SetEventHandle", hr);
  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr)) return Fail("GetService", hr);

  HANDLE watcher = CreateThread(nullptr, 0, WatchStdin, nullptr, 0, nullptr);
  if (watcher) CloseHandle(watcher);

  hr = client->Start();
  if (FAILED(hr)) return Fail("Start", hr);

  int code = 0;
  while (!g_stop) {
    // Sem som tocando, o Windows não manda pacotes: acordamos a cada 100 ms só para ver se é para parar.
    if (WaitForSingleObject(ready, 100) != WAIT_OBJECT_0) continue;
    for (;;) {
      UINT32 frames = 0;
      hr = capture->GetNextPacketSize(&frames);
      if (FAILED(hr)) {
        code = Fail("GetNextPacketSize", hr);
        g_stop = true;
        break;
      }
      if (frames == 0) break;
      BYTE* data = nullptr;
      DWORD flags = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) {
        code = Fail("GetBuffer", hr);
        g_stop = true;
        break;
      }
      DWORD bytes = frames * format.nBlockAlign;
      bool ok;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
        static BYTE zeros[kSampleRate * 4] = {};  // 1 s de silêncio, mais do que cabe num pacote
        ok = WriteAll(out, zeros, bytes < sizeof zeros ? bytes : sizeof zeros);
      } else {
        ok = WriteAll(out, data, bytes);
      }
      capture->ReleaseBuffer(frames);
      if (!ok) {  // o app fechou a saída
        g_stop = true;
        break;
      }
    }
  }

  client->Stop();
  capture->Release();
  client->Release();
  handler->Release();
  CloseHandle(ready);
  CoUninitialize();
  return code;
}
