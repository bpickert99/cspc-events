import { Outlet, NavLink, useParams, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function Layout() {
  const { user, logOut } = useAuth();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Detect if we're inside an event context
  const eventMatch = location.pathname.match(/^\/events\/([^/]+)/);
  const eventId = eventMatch ? eventMatch[1] : null;
  const isNewEvent = location.pathname === "/events/new";

  const handleLogout = async () => {
    await logOut();
    navigate("/login");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink to="/events" className="topbar-logo">
          <img src="./cspc-logo.png" alt="CSPC" />
          <span>Events</span>
        </NavLink>
        <div className="topbar-divider" />
        <span className="topbar-title">Center for the Study of the Presidency and Congress</span>
        <nav className="topbar-nav">
          <span className="topbar-user">{user?.displayName || user?.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Sign out</button>
        </nav>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <div className="sidebar-section">Events</div>
            <NavLink to="/events" end>📅 All Events</NavLink>
            <NavLink to="/events/new">＋ New Event</NavLink>

            {eventId && !isNewEvent && (
              <>
                <div className="sidebar-section" style={{ marginTop: "1rem" }}>This Event</div>
                <NavLink to={`/events/${eventId}`} end>📊 Overview & Tracking</NavLink>
                <NavLink to={`/events/${eventId}/guests`}>👥 Guests</NavLink>
                <NavLink to={`/events/${eventId}/invitations`}>✉️ Invitations</NavLink>
                <NavLink to={`/events/${eventId}/seating`}>🪑 Seating</NavLink>
              </>
            )}
          </nav>
        </aside>

        <main className="page-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
