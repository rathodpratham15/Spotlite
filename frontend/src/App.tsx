import React, { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { loadSession, clearSession, type Organizer } from "./utils/auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import EventDetail from "./pages/EventDetail";
import AttendeeScanner from "./pages/AttendeeScanner";

export default function App() {
  const session = loadSession();
  const [token, setToken] = useState<string | null>(session?.token || null);
  const [organizer, setOrganizer] = useState<Organizer | null>(session?.organizer || null);

  const handleLogin = (tok: string, org: Organizer) => {
    setToken(tok);
    setOrganizer(org);
  };

  const handleLogout = () => {
    clearSession();
    setToken(null);
    setOrganizer(null);
  };

  return (
    <Routes>
      <Route path="/scan" element={<AttendeeScanner />} />
      <Route
        path="/login"
        element={
          token ? <Navigate to="/dashboard" replace /> : <Login onLogin={handleLogin} />
        }
      />
      <Route
        path="/dashboard"
        element={
          token && organizer ? (
            <Dashboard token={token} organizer={organizer} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/events/:eventId"
        element={
          token && organizer ? (
            <EventDetail token={token} organizer={organizer} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={token ? "/dashboard" : "/scan"} replace />} />
    </Routes>
  );
}
