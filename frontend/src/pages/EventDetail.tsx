import React, { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Zap, LogOut, Users, Ticket, Upload, Trash2,
  Copy, Check, Mail, Download, Plus, ChevronDown, ChevronUp,
} from "lucide-react";
import { apiFetch } from "../utils/api";
import type { Organizer } from "../utils/auth";

interface Event {
  id: string; name: string; date: string; location: string; description: string;
  stats: { panelist_count: number; token_count: number; used_count: number; contact_count: number };
}
interface Panelist {
  id: string; name: string; title: string; company: string; bio: string;
  linkedin_url: string; image_url: string | null; face_encoded: number;
}
interface Token {
  id: string; code: string; attendee_name: string; attendee_email: string; used_at: string | null;
}

interface Props { token: string; organizer: Organizer; onLogout: () => void; }

type Tab = "panelists" | "codes" | "analytics";

export default function EventDetail({ token, organizer, onLogout }: Props) {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<Event | null>(null);
  const [panelists, setPanelists] = useState<Panelist[]>([]);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tab, setTab] = useState<Tab>("panelists");
  const [loading, setLoading] = useState(true);

  // Panelist form
  const [showPanForm, setShowPanForm] = useState(false);
  const [panForm, setPanForm] = useState({ name: "", title: "", company: "", bio: "", linkedin_url: "" });
  const [panPhoto, setPanPhoto] = useState<File | null>(null);
  const [panLoading, setPanLoading] = useState(false);
  const [panError, setPanError] = useState("");
  const photoRef = useRef<HTMLInputElement>(null);

  // Token generation
  const [genCount, setGenCount] = useState(10);
  const [genLoading, setGenLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);

  const loadAll = async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [ev, pans, toks] = await Promise.all([
        apiFetch<Event>(`/api/events/${eventId}`, {}, token),
        apiFetch<Panelist[]>(`/api/events/${eventId}/panelists`, {}, token),
        apiFetch<Token[]>(`/api/events/${eventId}/tokens`, {}, token),
      ]);
      setEvent(ev); setPanelists(pans); setTokens(toks);
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, [eventId]);

  const addPanelist = async (e: React.FormEvent) => {
    e.preventDefault(); setPanError(""); setPanLoading(true);
    try {
      const fd = new FormData();
      Object.entries(panForm).forEach(([k, v]) => fd.append(k, v));
      if (panPhoto) fd.append("photo", panPhoto);
      await apiFetch<Panelist>(`/api/events/${eventId}/panelists`, { method: "POST", body: fd }, token);
      setPanForm({ name: "", title: "", company: "", bio: "", linkedin_url: "" });
      setPanPhoto(null); if (photoRef.current) photoRef.current.value = "";
      setShowPanForm(false); await loadAll();
    } catch (err: unknown) {
      setPanError(err instanceof Error ? err.message : "Failed");
    } finally { setPanLoading(false); }
  };

  const deletePanelist = async (id: string) => {
    if (!confirm("Remove this panelist?")) return;
    await apiFetch(`/api/events/${eventId}/panelists/${id}`, { method: "DELETE" }, token);
    await loadAll();
  };

  const generateTokens = async () => {
    setGenLoading(true);
    try {
      await apiFetch(`/api/events/${eventId}/tokens`, { method: "POST", body: JSON.stringify({ count: genCount }) }, token);
      await loadAll();
    } finally { setGenLoading(false); }
  };

  const deleteToken = async (id: string) => {
    await apiFetch(`/api/events/${eventId}/tokens/${id}`, { method: "DELETE" }, token);
    await loadAll();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    });
  };

  const sendEmails = async () => {
    setEmailSending(true); setEmailResult(null);
    try {
      const r = await apiFetch<{ sent: number; failed: number; skipped: number }>(
        `/api/events/${eventId}/tokens/send-emails`, { method: "POST" }, token
      );
      setEmailResult(`Sent ${r.sent}, skipped ${r.skipped}, failed ${r.failed}`);
    } finally { setEmailSending(false); }
  };

  const exportCSV = () => {
    const rows = [["code", "attendee_name", "attendee_email", "used_at"],
      ...tokens.map((t) => [t.code, t.attendee_name || "", t.attendee_email || "", t.used_at || ""])];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${event?.name || "event"}-codes.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Loading…</div>;
  if (!event) return <div className="min-h-screen flex items-center justify-center text-gray-400 text-sm">Event not found</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/dashboard" className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-sky-500 rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-gray-900 truncate max-w-[200px]">{event.name}</span>
            </div>
          </div>
          <button onClick={onLogout} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* Event meta */}
        <div className="mb-5">
          {(event.date || event.location) && (
            <p className="text-sm text-gray-500">{event.date}{event.date && event.location ? " · " : ""}{event.location}</p>
          )}
          {event.description && <p className="text-sm text-gray-500 mt-1">{event.description}</p>}
          <div className="flex gap-4 mt-3">
            {[
              { icon: <Users className="w-3.5 h-3.5" />, v: event.stats.panelist_count, l: "panelists" },
              { icon: <Ticket className="w-3.5 h-3.5" />, v: event.stats.token_count, l: "codes generated" },
              { icon: <Ticket className="w-3.5 h-3.5" />, v: event.stats.used_count, l: "codes used" },
            ].map(({ icon, v, l }) => (
              <div key={l} className="flex items-center gap-1 text-xs text-gray-400">
                {icon}<span className="font-medium text-gray-700">{v}</span><span>{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
          {(["panelists", "codes", "analytics"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all capitalize ${
                tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Panelists tab */}
        {tab === "panelists" && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-medium text-gray-900">Panelists ({panelists.length})</h2>
              <button onClick={() => setShowPanForm(!showPanForm)}
                className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors">
                <Plus className="w-3.5 h-3.5" />Add panelist
              </button>
            </div>

            {showPanForm && (
              <form onSubmit={addPanelist} className="bg-white border border-gray-100 rounded-xl p-5 mb-4 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input required placeholder="Full name *" value={panForm.name}
                    onChange={(e) => setPanForm({ ...panForm, name: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  <input placeholder="Title / role" value={panForm.title}
                    onChange={(e) => setPanForm({ ...panForm, title: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  <input placeholder="Company" value={panForm.company}
                    onChange={(e) => setPanForm({ ...panForm, company: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  <input placeholder="LinkedIn URL" value={panForm.linkedin_url}
                    onChange={(e) => setPanForm({ ...panForm, linkedin_url: e.target.value })}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  <div className="sm:col-span-2">
                    <textarea placeholder="Bio (optional)" value={panForm.bio} rows={2}
                      onChange={(e) => setPanForm({ ...panForm, bio: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Photo (for face recognition)</label>
                    <input ref={photoRef} type="file" accept="image/*"
                      onChange={(e) => setPanPhoto(e.target.files?.[0] || null)}
                      className="text-sm text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-sky-50 file:text-sky-600 hover:file:bg-sky-100" />
                  </div>
                </div>
                {panError && <p className="text-sm text-red-600 mt-2">{panError}</p>}
                <div className="flex gap-2 mt-4">
                  <button type="submit" disabled={panLoading}
                    className="bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                    {panLoading ? "Adding…" : "Add panelist"}
                  </button>
                  <button type="button" onClick={() => setShowPanForm(false)} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2">
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {panelists.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No panelists yet.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {panelists.map((p) => (
                  <div key={p.id} className="bg-white border border-gray-100 rounded-xl p-4 flex gap-3">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-lg font-semibold text-gray-400">
                        {p.name[0]}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-gray-900 truncate">{p.name}</p>
                          {p.title && <p className="text-xs text-gray-500 truncate">{p.title}{p.company ? ` · ${p.company}` : ""}</p>}
                        </div>
                        <button onClick={() => deletePanelist(p.id)} className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-400 transition-colors shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className={`inline-block mt-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${p.face_encoded ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                        {p.face_encoded ? "Face enrolled" : "No face"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Codes tab */}
        {tab === "codes" && (
          <div>
            <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
              <h2 className="font-medium text-gray-900">Access Codes ({tokens.length})</h2>
              <div className="flex gap-2 flex-wrap">
                {tokens.length > 0 && (
                  <>
                    <button onClick={exportCSV}
                      className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors">
                      <Download className="w-3.5 h-3.5" />Export CSV
                    </button>
                    <button onClick={sendEmails} disabled={emailSending}
                      className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60">
                      <Mail className="w-3.5 h-3.5" />{emailSending ? "Sending…" : "Email codes"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {emailResult && (
              <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">{emailResult}</p>
            )}

            {/* Generate */}
            <div className="bg-white border border-gray-100 rounded-xl p-4 mb-4 flex flex-wrap gap-3 items-center">
              <label className="text-sm text-gray-600">Generate</label>
              <input type="number" min={1} max={500} value={genCount}
                onChange={(e) => setGenCount(Number(e.target.value))}
                className="w-20 px-2 py-1.5 border border-gray-200 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-sky-500" />
              <label className="text-sm text-gray-600">unique codes</label>
              <button onClick={generateTokens} disabled={genLoading}
                className="bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors">
                {genLoading ? "Generating…" : "Generate"}
              </button>
            </div>

            {tokens.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">No codes yet.</div>
            ) : (
              <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Code</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide hidden sm:table-cell">Attendee</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tokens.map((t) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <code className="font-mono text-xs font-semibold text-gray-800 bg-gray-100 px-2 py-0.5 rounded">{t.code}</code>
                            <button onClick={() => copyCode(t.code)} className="text-gray-300 hover:text-sky-500 transition-colors">
                              {copiedCode === t.code ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell">
                          {t.attendee_name || t.attendee_email || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${t.used_at ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"}`}>
                            {t.used_at ? "Used" : "Unused"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => deleteToken(t.id)} className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-400 transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Analytics tab */}
        {tab === "analytics" && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Panelists", value: event.stats.panelist_count, color: "text-sky-600" },
              { label: "Codes issued", value: event.stats.token_count, color: "text-indigo-600" },
              { label: "Codes used", value: event.stats.used_count, color: "text-emerald-600" },
              { label: "Contacts saved", value: event.stats.contact_count, color: "text-amber-600" },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white border border-gray-100 rounded-xl p-5">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <p className={`text-3xl font-bold ${color}`}>{value}</p>
              </div>
            ))}
            {event.stats.token_count > 0 && (
              <div className="col-span-2 sm:col-span-4 bg-white border border-gray-100 rounded-xl p-5">
                <p className="text-xs text-gray-500 mb-2">Adoption rate</p>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full transition-all"
                    style={{ width: `${Math.round((event.stats.used_count / event.stats.token_count) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {Math.round((event.stats.used_count / event.stats.token_count) * 100)}% of codes activated
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
