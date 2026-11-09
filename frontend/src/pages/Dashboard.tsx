import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Zap, LogOut, Calendar, Users, Ticket, ChevronRight } from "lucide-react";
import { apiFetch } from "../utils/api";
import type { Organizer } from "../utils/auth";

interface Event {
  id: string;
  name: string;
  date: string;
  location: string;
  description: string;
  stats: { panelist_count: number; token_count: number; used_count: number; contact_count: number };
}

interface Props {
  token: string;
  organizer: Organizer;
  onLogout: () => void;
}

export default function Dashboard({ token, organizer, onLogout }: Props) {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", location: "", description: "" });
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Event[]>("/api/events", {}, token);
      setEvents(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await apiFetch<Event>("/api/events", {
        method: "POST",
        body: JSON.stringify(form),
      }, token);
      setForm({ name: "", date: "", location: "", description: "" });
      setShowCreate(false);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-sky-500 rounded-lg flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-gray-900">Spotlite</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 hidden sm:block">{organizer.name}</span>
            <button onClick={onLogout} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Events</h1>
            <p className="text-sm text-gray-500 mt-0.5">{events.length} event{events.length !== 1 ? "s" : ""}</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New event
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <form onSubmit={createEvent} className="bg-white border border-gray-100 rounded-xl p-5 mb-6 shadow-sm">
            <h2 className="font-medium text-gray-900 mb-4">Create new event</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <input
                  required
                  placeholder="Event name *"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-gray-600"
              />
              <input
                placeholder="Location"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="sm:col-span-2">
                <textarea
                  placeholder="Description (optional)"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            <div className="flex gap-2 mt-4">
              <button
                type="submit"
                disabled={creating}
                className="bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {creating ? "Creating…" : "Create event"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Events list */}
        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <Calendar className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-gray-500 text-sm">No events yet. Create your first one above.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <Link
                key={ev.id}
                to={`/events/${ev.id}`}
                className="block bg-white border border-gray-100 rounded-xl p-5 hover:border-sky-200 hover:shadow-sm transition-all group"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900 group-hover:text-sky-600 transition-colors truncate">{ev.name}</h3>
                    {(ev.date || ev.location) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {ev.date}{ev.date && ev.location ? " · " : ""}{ev.location}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-sky-400 shrink-0 mt-0.5 transition-colors" />
                </div>
                <div className="flex gap-4 mt-3">
                  <Stat icon={<Users className="w-3.5 h-3.5" />} value={ev.stats.panelist_count} label="panelists" />
                  <Stat icon={<Ticket className="w-3.5 h-3.5" />} value={ev.stats.token_count} label="codes" />
                  <Stat icon={<Ticket className="w-3.5 h-3.5" />} value={ev.stats.used_count} label="used" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      {icon}
      <span className="font-medium text-gray-600">{value}</span>
      <span>{label}</span>
    </div>
  );
}
