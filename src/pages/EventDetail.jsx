import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";

function formatDate(ts) {
  if (!ts) return "Date TBD";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function fmt24(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}

export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [stats, setStats] = useState({ total: 0, yes: 0, no: 0, pending: 0, sent: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      setLoading(false);
    });

    // Guest stats
    getDocs(query(collection(db, "guests"), where("eventId", "==", id))).then((snap) => {
      const guests = snap.docs.map((d) => d.data());
      setStats({
        total: guests.length,
        yes: guests.filter((g) => g.rsvpStatus === "yes" || g.rsvpStatus === "partial").length,
        no: guests.filter((g) => g.rsvpStatus === "no").length,
        pending: guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length,
        sent: guests.filter((g) => g.emailSent).length,
      });
    });
  }, [id]);

  if (loading) return <div className="loading">Loading...</div>;
  if (!event) return <div className="error-msg">Event not found.</div>;

  const quickLinks = [
    { to: `/events/${id}/guests`, icon: "👥", label: "Manage Guests", desc: `${stats.total} invited` },
    { to: `/events/${id}/invitations`, icon: "✉️", label: "Invitations", desc: `${stats.sent} sent` },
    { to: `/events/${id}/tracking`, icon: "📊", label: "Tracking", desc: `${stats.yes} attending` },
    ...(event.hasSeating ? [{ to: `/events/${id}/seating`, icon: "🪑", label: "Seating", desc: "Manage tables" }] : []),
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{event.name}</h1>
          <p>{formatDate(event.date)}{event.location ? ` · ${event.location}` : ""}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/events/${id}/edit`)}>Edit Event</button>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Guests Invited</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)" }}>{stats.yes}</div>
          <div className="stat-label">Attending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--amber)" }}>{stats.pending}</div>
          <div className="stat-label">Awaiting Response</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{stats.no}</div>
          <div className="stat-label">Declined</div>
        </div>
      </div>

      {/* Quick nav */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.75rem" }}>
        {quickLinks.map((link) => (
          <Link key={link.to} to={link.to} style={{ textDecoration: "none" }}>
            <div className="card" style={{ padding: "1.25rem", cursor: "pointer", transition: "box-shadow 0.15s, border-color 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{link.icon}</div>
              <div style={{ fontWeight: 700, color: "var(--navy-dark)", fontSize: "0.9375rem" }}>{link.label}</div>
              <div style={{ fontSize: "0.8125rem", color: "var(--gray-400)", marginTop: "0.25rem" }}>{link.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Event parts */}
      {event.parts && event.parts.length > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header"><h2>Event Parts</h2></div>
          <div className="card-body" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {event.parts.map((p) => (
              <div key={p.id} style={{ background: "var(--navy-light)", borderRadius: "var(--radius)", padding: "0.875rem 1.125rem", minWidth: 150 }}>
                <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: "0.25rem" }}>{p.name}</div>
                {p.startTime && <div style={{ fontSize: "0.8125rem", color: "var(--gray-600)" }}>{fmt24(p.startTime)}{p.endTime ? ` – ${fmt24(p.endTime)}` : ""}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom fields summary */}
      {event.customFields && event.customFields.length > 0 && (
        <div className="card">
          <div className="card-header"><h2>RSVP Form Fields</h2></div>
          <div className="card-body">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              {event.customFields.map((f) => (
                <span key={f.id} className="tag">{f.label}</span>
              ))}
            </div>
            <div style={{ marginTop: "0.875rem" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/events/${id}/edit`)}>Edit Fields</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
