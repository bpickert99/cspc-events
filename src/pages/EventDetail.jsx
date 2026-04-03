import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { doc, getDoc, collection, query, where, getDocs, deleteDoc, writeBatch } from "firebase/firestore";
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
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      setLoading(false);
    });
    getDocs(query(collection(db, "guests"), where("eventId", "==", id))).then((snap) => {
      setGuests(snap.docs.map((d) => d.data()));
    });
  }, [id]);

  const deleteEvent = async () => {
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${event?.name}"?\n\nThis will delete the event and all ${guests.length} guest record(s). This cannot be undone.`
    );
    if (!confirmed) return;
    setDeleting(true);
    try {
      // Delete all guests first
      const guestSnap = await getDocs(query(collection(db, "guests"), where("eventId", "==", id)));
      const batch = writeBatch(db);
      guestSnap.docs.forEach((d) => batch.delete(d.ref));
      // Delete seating and template docs
      batch.delete(doc(db, "seating", id));
      batch.delete(doc(db, "emailTemplates", id));
      await batch.commit();
      // Delete the event itself
      await deleteDoc(doc(db, "events", id));
      navigate("/events");
    } catch (err) {
      alert("Failed to delete event: " + err.message);
      setDeleting(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!event) return <div className="error-msg">Event not found.</div>;

  // Overall stats
  const total = guests.length;
  const sent = guests.filter((g) => g.emailSent).length;
  const attending = guests.filter((g) => g.rsvpStatus === "yes" || g.rsvpStatus === "partial").length;
  const declined = guests.filter((g) => g.rsvpStatus === "no").length;
  const pending = guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length;

  // Per-part breakdown
  const partBreakdown = (event.parts || []).map((part) => {
    const invited = guests.filter((g) => (g.invitedParts || []).includes(part.id));
    const att = guests.filter((g) =>
      (g.rsvpStatus === "yes" || g.rsvpStatus === "partial") &&
      (g.rsvpParts || g.invitedParts || []).includes(part.id)
    );
    const pend = invited.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending");
    return { part, invited: invited.length, attending: att.length, pending: pend.length };
  });

  const quickLinks = [
    { to: `/events/${id}/guests`, icon: "👥", label: "Manage Guests", desc: `${total} invited` },
    { to: `/events/${id}/invitations`, icon: "✉️", label: "Invitations", desc: `${sent} sent` },
    { to: `/events/${id}/tracking`, icon: "📊", label: "Tracking", desc: `${attending} attending` },
    ...(event.hasSeating ? [{ to: `/events/${id}/seating`, icon: "🪑", label: "Seating", desc: "Manage tables" }] : []),
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{event.name}</h1>
          <p>
            {formatDate(event.date)}
            {event.location ? ` · ${event.location}` : ""}
          </p>
          {(event.coHosts || []).length > 0 && (
            <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "var(--gray-400)" }}>
              Co-hosts: {event.coHosts.join(", ")}
            </p>
          )}
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/events/${id}/edit`)}>Edit Event</button>
          <button className="btn btn-danger btn-sm" onClick={deleteEvent} disabled={deleting}>
            {deleting ? "Deleting..." : "Delete Event"}
          </button>
        </div>
      </div>

      {/* Overall stats */}
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">Guests Invited</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)" }}>{attending}</div>
          <div className="stat-label">Attending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--amber)" }}>{pending}</div>
          <div className="stat-label">Awaiting Response</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{declined}</div>
          <div className="stat-label">Declined</div>
        </div>
      </div>

      {/* Per-part RSVP breakdown */}
      {partBreakdown.length > 1 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header"><h2>Attendance by Part</h2></div>
          <div className="card-body" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {partBreakdown.map(({ part, invited, attending, pending }) => (
              <div key={part.id} style={{ flex: "1", minWidth: 180, background: "var(--gray-50)", borderRadius: "var(--radius)", padding: "1rem" }}>
                <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: "0.625rem" }}>
                  {part.name}
                  {part.startTime && <span style={{ fontWeight: 400, fontSize: "0.8125rem", color: "var(--gray-400)", marginLeft: "0.5rem" }}>{fmt24(part.startTime)}</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--gray-600)" }}>Invited</span>
                    <strong>{invited}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--green)" }}>Attending</span>
                    <strong style={{ color: "var(--green)" }}>{attending}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--amber)" }}>Pending</span>
                    <strong style={{ color: "var(--amber)" }}>{pending}</strong>
                  </div>
                </div>
                <div className="progress-bar" style={{ marginTop: "0.625rem" }}>
                  <div className="progress-fill green" style={{ width: invited > 0 ? `${(attending / invited) * 100}%` : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick nav */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1.75rem" }}>
        {quickLinks.map((link) => (
          <Link key={link.to} to={link.to} style={{ textDecoration: "none" }}>
            <div className="card" style={{ padding: "1.25rem", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>{link.icon}</div>
              <div style={{ fontWeight: 700, color: "var(--navy-dark)", fontSize: "0.9375rem" }}>{link.label}</div>
              <div style={{ fontSize: "0.8125rem", color: "var(--gray-400)", marginTop: "0.25rem" }}>{link.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Tags */}
      {(event.tags || []).length > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header"><h2>Guest Tags</h2></div>
          <div className="card-body" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {event.tags.map((tag) => (
              <span key={tag.id} style={{ display: "inline-flex", alignItems: "center", padding: "0.25rem 0.75rem", borderRadius: "99px", background: tag.color + "22", fontSize: "0.8125rem", fontWeight: 700, color: tag.color }}>
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Custom fields summary */}
      {(event.customFields || []).length > 0 && (
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
