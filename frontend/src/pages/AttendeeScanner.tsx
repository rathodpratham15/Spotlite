import React, { useState, useRef, useCallback } from "react";
import { Camera, Zap, CheckCircle, User, Linkedin, Building2, X, QrCode } from "lucide-react";
import { apiFetch } from "../utils/api";

interface EventInfo {
  event_id: string;
  event_name: string;
  event_date: string;
  event_location: string;
  attendee_name: string;
  code: string;
}

interface ScanResult {
  matched: boolean;
  confidence: number;
  name?: string;
  title?: string;
  image_url?: string | null;
  panelist_id?: string;
  contact?: { id: string };
}

interface SavedContact {
  panelist_id: string;
  panelist_name: string;
  title?: string;
  company?: string;
  linkedin_url?: string;
  image_path?: string;
  image_url?: string | null;
  saved_at: string;
}

type Phase = "enter-code" | "scanning" | "contacts";

export default function AttendeeScanner() {
  const [phase, setPhase] = useState<Phase>("enter-code");
  const [codeInput, setCodeInput] = useState("");
  const [eventInfo, setEventInfo] = useState<EventInfo | null>(null);
  const [validating, setValidating] = useState(false);
  const [codeError, setCodeError] = useState("");

  const [cameraOn, setCameraOn] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [eventName, setEventName] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const validateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError(""); setValidating(true);
    try {
      const data = await apiFetch<EventInfo>("/api/attend/validate", {
        method: "POST",
        body: JSON.stringify({ code: codeInput.trim().toUpperCase() }),
      });
      setEventInfo(data);
      setPhase("scanning");
    } catch (err: unknown) {
      setCodeError(err instanceof Error ? err.message : "Invalid code");
    } finally { setValidating(false); }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
    } catch {
      alert("Could not access camera. Please allow camera permissions.");
    }
  };

  const stopCamera = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  const captureFrame = useCallback(async () => {
    if (!videoRef.current || !eventInfo || scanning) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      setScanning(true);
      try {
        const fd = new FormData();
        fd.append("code", eventInfo.code);
        fd.append("photo", blob, "frame.jpg");
        const result = await apiFetch<ScanResult>("/api/attend/scan", { method: "POST", body: fd });
        if (result.matched) {
          setLastResult(result);
          stopCamera();
        }
      } catch { /* ignore */ } finally { setScanning(false); }
    }, "image/jpeg", 0.85);
  }, [eventInfo, scanning]);

  const startScanning = async () => {
    await startCamera();
    intervalRef.current = setInterval(captureFrame, 2500);
  };

  const loadContacts = async () => {
    if (!eventInfo) return;
    try {
      const data = await apiFetch<{ event_name: string; contacts: SavedContact[] }>(
        `/api/attend/contacts?code=${eventInfo.code}`
      );
      setContacts(data.contacts);
      setEventName(data.event_name);
      setPhase("contacts");
      stopCamera();
    } catch { /* ignore */ }
  };

  const scanAnother = async () => {
    setLastResult(null);
    await startScanning();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-sky-500 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-gray-900">Spotlite</span>
          </div>
          {phase !== "enter-code" && (
            <div className="flex gap-2">
              <button onClick={loadContacts} className="text-xs text-sky-500 hover:text-sky-600 font-medium px-2 py-1 rounded">
                My contacts
              </button>
              <button onClick={() => { stopCamera(); setPhase("enter-code"); setEventInfo(null); setCodeInput(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded">
                Leave event
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {/* Enter code phase */}
        {phase === "enter-code" && (
          <div className="text-center">
            <div className="w-14 h-14 bg-sky-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <QrCode className="w-7 h-7 text-sky-500" />
            </div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Join Event</h1>
            <p className="text-sm text-gray-500 mb-8">Enter the access code you received for the event</p>

            <form onSubmit={validateCode} className="space-y-3">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="ENTER CODE"
                maxLength={12}
                required
                className="w-full text-center text-2xl font-mono tracking-widest px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-sky-500 bg-white uppercase"
              />
              {codeError && <p className="text-sm text-red-600">{codeError}</p>}
              <button type="submit" disabled={validating || !codeInput.trim()}
                className="w-full bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white font-medium py-3 rounded-xl transition-colors">
                {validating ? "Validating…" : "Join Event"}
              </button>
            </form>

            <p className="text-xs text-gray-400 mt-6">
              Organizer?{" "}
              <a href="/login" className="text-sky-500 hover:underline">Sign in here</a>
            </p>
          </div>
        )}

        {/* Scanning phase */}
        {phase === "scanning" && eventInfo && (
          <div>
            <div className="bg-sky-50 border border-sky-100 rounded-xl px-4 py-3 mb-6">
              <p className="text-xs text-sky-600 font-medium">{eventInfo.event_name}</p>
              {eventInfo.attendee_name && <p className="text-xs text-sky-500 mt-0.5">Welcome, {eventInfo.attendee_name}</p>}
            </div>

            {/* Result card */}
            {lastResult && lastResult.matched && (
              <div className="bg-white border border-green-100 rounded-xl p-5 mb-5 flex gap-4">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center">
                  {lastResult.image_url ? (
                    <img src={lastResult.image_url} alt={lastResult.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-6 h-6 text-gray-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-gray-900">{lastResult.name}</p>
                      {lastResult.title && <p className="text-sm text-gray-500">{lastResult.title}</p>}
                    </div>
                    <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                  </div>
                  <p className="text-xs text-green-600 mt-1.5 font-medium">Saved to contacts</p>
                </div>
              </div>
            )}

            {/* Camera */}
            {cameraOn ? (
              <div>
                <div className="relative bg-black rounded-2xl overflow-hidden aspect-[4/3] mb-4">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  {scanning && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  <div className="absolute inset-0 border-[3px] border-sky-400 rounded-2xl pointer-events-none opacity-50" />
                </div>
                <div className="flex gap-2">
                  <button onClick={stopCamera}
                    className="flex-1 py-3 border border-gray-200 text-gray-600 font-medium rounded-xl text-sm hover:bg-gray-50 transition-colors">
                    Stop camera
                  </button>
                  {lastResult?.matched && (
                    <button onClick={scanAnother}
                      className="flex-1 py-3 bg-sky-500 hover:bg-sky-600 text-white font-medium rounded-xl text-sm transition-colors">
                      Scan another
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <button onClick={startScanning}
                  className="w-full flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 text-white font-medium py-4 rounded-xl transition-colors mb-3">
                  <Camera className="w-5 h-5" />
                  {lastResult?.matched ? "Scan another person" : "Start scanning"}
                </button>
                <button onClick={loadContacts} className="w-full py-3 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors">
                  View my contacts ({contacts.length > 0 ? contacts.length : "0"})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Contacts phase */}
        {phase === "contacts" && (
          <div>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-semibold text-gray-900">{eventName}</h2>
                <p className="text-sm text-gray-500">{contacts.length} contact{contacts.length !== 1 ? "s" : ""} saved</p>
              </div>
              <button onClick={() => setPhase("scanning")}
                className="text-sm text-sky-500 hover:text-sky-600 font-medium">
                Back to scanner
              </button>
            </div>

            {contacts.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No contacts saved yet. Scan someone!
              </div>
            ) : (
              <div className="space-y-3">
                {contacts.map((c) => (
                  <div key={c.panelist_id || c.panelist_name} className="bg-white border border-gray-100 rounded-xl p-4 flex gap-3 items-center">
                    <div className="w-11 h-11 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                      {c.image_url ? (
                        <img src={c.image_url} alt={c.panelist_name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="font-semibold text-gray-400 text-sm">{c.panelist_name[0]}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{c.panelist_name}</p>
                      {(c.title || c.company) && (
                        <p className="text-xs text-gray-500 truncate">
                          {c.title}{c.title && c.company ? " · " : ""}{c.company}
                        </p>
                      )}
                    </div>
                    {c.linkedin_url && (
                      <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                        className="p-1.5 hover:bg-blue-50 rounded-lg text-gray-300 hover:text-blue-500 transition-colors shrink-0">
                        <Linkedin className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
