import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import EventList from "./pages/EventList";
import EventCreate from "./pages/EventCreate";
import EventDetail from "./pages/EventDetail";
import GuestManager from "./pages/GuestManager";
import InvitationComposer from "./pages/InvitationComposer";
import SeatingManager from "./pages/SeatingManager";
import RSVPPage from "./pages/RSVPPage";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/rsvp/:token" element={<RSVPPage />} />

      {/* Protected (staff) */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/events" replace />} />
        <Route path="events" element={<EventList />} />
        <Route path="events/new" element={<EventCreate />} />
        <Route path="events/:id" element={<EventDetail />} />
        <Route path="events/:id/edit" element={<EventCreate />} />
        <Route path="events/:id/guests" element={<GuestManager />} />
        <Route path="events/:id/invitations" element={<InvitationComposer />} />
        <Route path="events/:id/tracking" element={<Navigate to="../" relative="path" replace />} />
        <Route path="events/:id/seating" element={<SeatingManager />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
