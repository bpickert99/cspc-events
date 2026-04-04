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
    const confirmed = window.confirm(`Permanently delete "${event?.name}"?\n\nThis will remove the event and all ${guests.length} guest record(s). This cannot be undone.`);
    if (!confirmed) return;
    setDeleting(true);
    try {
      const guestSnap = await getDocs(query(collection(db, "guests"), where("eventId", "==", id)));
      const batch = writeBatch(db);
      guestSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, "seating", id));
      batch.delete(doc(db, "emailTemplates", id));
      await batch.commit();
      await deleteDoc(doc(db, "events", id));
      navigate("/events");
    } catch (err) {
      alert("Failed to delete: " + err.message);
      setDeleting(false);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!event) return <div className="error-msg">Event not found.</div>;

  // Only count primary guests (not plus ones) for stats
  const total = guests.length;
  const sent = guests.filter((g) => g.emailSent).length;
  const attending = guests.filter((g) => g.rsvpStatus === "yes").length;
  const plusOnesAttending = guests.filter((g) => g.plusOneRsvpStatus === "yes" && g.rsvpStatus === "yes").length;
  const totalAttending = attending + plusOnesAttending;
  const declined = guests.filter((g) => g.rsvpStatus === "no").length;
  const pending = guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length;
  // Response rate: only count guests who were sent emails
  const responded = attending + declined;
  const responseRate = sent > 0 ? Math.min(100, Math.round((responded / sent) * 100)) : 0;

  const partBreakdown = (event.parts || []).map((part) => {
    const invited = guests.filter((g) => (g.invitedParts || []).includes(part.id));
    const att = guests.filter((g) =>
      g.rsvpStatus === "yes" && (g.rsvpParts?.includes(part.id) ?? (g.invitedParts || []).includes(part.id))
    );
    const plusOnes = att.filter((g) => g.plusOneRsvpStatus === "yes").length;
    const pend = invited.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending");
    return { part, invited: invited.length, attending: att.length, plusOnes, pending: pend.length };
  });

  const quickLinks = [
    { to: `/events/${id}/guests`, icon: "👥", label: "Guests", desc: `${total} invited` },
    { to: `/events/${id}/invitations`, icon: "✉️", label: "Invitations", desc: `${sent} sent` },
    { to: `/events/${id}/tracking`, icon: "📊", label: "Tracking", desc: `${totalAttending} attending` },
    ...(event.hasSeating ? [{ to: `/events/${id}/seating`, icon: "🪑", label: "Seating", desc: "Manage tables" }] : []),
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{event.name}</h1>
          <p>{formatDate(event.date)}{event.location ? ` · ${event.location.split(",")[0]}` : ""}</p>
          {(event.coHosts || []).length > 0 && (
            <p style={{ marginTop: "0.25rem", fontSize: "0.8125rem", color: "var(--gray-400)" }}>Co-hosts: {event.coHosts.join(", ")}</p>
          )}
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/events/${id}/edit`)}>Edit Event</button>
          <button className="btn btn-danger btn-sm" onClick={deleteEvent} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">Guests Invited</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)" }}>{attending}</div>
          <div className="stat-label">Attending</div>
          {plusOnesAttending > 0 && <div style={{ fontSize: "0.75rem", color: "var(--gold-dark)", marginTop: "0.25rem" }}>+ {plusOnesAttending} plus one{plusOnesAttending !== 1 ? "s" : ""}</div>}
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--green)", fontSize: "1.75rem" }}>{totalAttending}</div>
          <div className="stat-label">Total Seats Needed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--amber)" }}>{pending}</div>
          <div className="stat-label">Awaiting Response</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--red)" }}>{declined}</div>
          <div className="stat-label">Declined</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: "var(--navy)" }}>{responseRate}%</div>
          <div className="stat-label">Response Rate</div>
        </div>
      </div>

      {partBreakdown.length > 1 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header"><h2>Attendance by Part</h2></div>
          <div className="card-body" style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            {partBreakdown.map(({ part, invited, attending, plusOnes, pending }) => (
              <div key={part.id} style={{ flex: "1", minWidth: 180, background: "var(--gray-50)", borderRadius: "var(--radius)", padding: "1rem", border: "1px solid var(--gray-100)" }}>
                <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: "0.625rem" }}>
                  {part.name}
                  {part.startTime && <span style={{ fontWeight: 400, fontSize: "0.8125rem", color: "var(--gray-400)", marginLeft: "0.5rem" }}>{fmt24(part.startTime)}</span>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--gray-500)" }}>Invited</span><strong>{invited}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--green)" }}>Attending</span><strong style={{ color: "var(--green)" }}>{attending}{plusOnes > 0 ? ` + ${plusOnes}` : ""}</strong></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--amber)" }}>Pending</span><strong style={{ color: "var(--amber)" }}>{pending}</strong></div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill green" style={{ width: invited > 0 ? `${(attending / invited) * 100}%` : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.75rem" }}>
        {quickLinks.map((link) => (
          <Link key={link.to} to={link.to} style={{ textDecoration: "none" }}>
            <div className="card" style={{ padding: "1.25rem", cursor: "pointer", transition: "var(--transition)" }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.boxShadow = "var(--shadow-md)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = ""; e.currentTarget.style.boxShadow = ""; e.currentTarget.style.transform = ""; }}>
              <div style={{ fontSize: "1.375rem", marginBottom: "0.5rem" }}>{link.icon}</div>
              <div style={{ fontWeight: 700, color: "var(--gray-700)", fontSize: "0.9375rem" }}>{link.label}</div>
              <div style={{ fontSize: "0.8125rem", color: "var(--gray-400)", marginTop: "0.25rem" }}>{link.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {(event.tags || []).length > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header"><h2>Guest Tags</h2></div>
          <div className="card-body" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {event.tags.map((tag) => (
              <span key={tag.id} style={{ padding: "0.25rem 0.875rem", borderRadius: "99px", background: tag.color + "22", fontSize: "0.8125rem", fontWeight: 700, color: tag.color, border: `1px solid ${tag.color}44` }}>{tag.name}</span>
            ))}
          </div>
        </div>
      )}

      {(event.customFields || []).length > 0 && (
        <div className="card">
          <div className="card-header"><h2>RSVP Form Fields</h2></div>
          <div className="card-body">
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.875rem" }}>
              {event.customFields.map((f) => <span key={f.id} className="tag">{f.label}</span>)}
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/events/${id}/edit`)}>Edit Fields</button>
          </div>
        </div>
      )}
    </div>
  );
}
