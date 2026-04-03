import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "long", day: "numeric" });
}

export default function EventList() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("date", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  if (loading) return <div className="loading">Loading events...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Events</h1>
          <p>Manage invitations, RSVPs, and seating for all CSPC events.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => navigate("/events/new")}>
            ＋ New Event
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📅</div>
          <h3>No events yet</h3>
          <p>Create your first event to get started.</p>
          <button className="btn btn-primary" style={{ marginTop: "1rem" }} onClick={() => navigate("/events/new")}>
            Create Event
          </button>
        </div>
      ) : (
        <div className="event-grid">
          {events.map((event) => (
            <div key={event.id} className="event-card" onClick={() => navigate(`/events/${event.id}`)}>
              <div className="event-card-date">{formatDate(event.date)}</div>
              <h3>{event.name}</h3>
              {event.location && <div className="event-card-location">📍 {event.location}</div>}
              <div className="event-card-parts">
                {(event.parts || []).map((p) => (
                  <span key={p.id} className="tag">{p.name}</span>
                ))}
              </div>
              {event.guestCount > 0 && (
                <div style={{ marginTop: "0.625rem", fontSize: "0.8125rem", color: "var(--gray-400)" }}>
                  {event.guestCount} guests invited
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
