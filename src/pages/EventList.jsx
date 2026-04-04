import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

function formatDate(ts) {
  if (!ts) return "Date TBD";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
}

function formatMonth(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getDate(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}

function EventCard({ event, onClick }) {
  const date = getDate(event.date);
  const isPast = date && date < new Date();
  return (
    <div className="event-card" onClick={onClick} style={{ opacity: isPast ? 0.75 : 1 }}>
      <div className="event-card-date">{formatDate(event.date)}</div>
      <h3>{event.name}</h3>
      {event.location && <div className="event-card-location">📍 {event.location.split(",")[0]}</div>}
      <div className="event-card-parts">
        {(event.parts || []).map((p) => <span key={p.id} className="tag">{p.name}</span>)}
      </div>
      {event.guestCount > 0 && (
        <div style={{ marginTop: "0.625rem", fontSize: "0.8rem", color: "var(--gray-400)" }}>{event.guestCount} guests</div>
      )}
    </div>
  );
}

// Calendar view — shows a month grid
function CalendarView({ events, onEventClick }) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prevMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const eventsThisMonth = events.filter((e) => {
    const d = getDate(e.date);
    return d && d.getFullYear() === year && d.getMonth() === month;
  });

  const dayEvents = {};
  eventsThisMonth.forEach((e) => {
    const d = getDate(e.date);
    if (d) {
      const day = d.getDate();
      if (!dayEvents[day]) dayEvents[day] = [];
      dayEvents[day].push(e);
    }
  });

  const today = new Date();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <button className="btn btn-ghost btn-sm" onClick={prevMonth}>← Prev</button>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 700, color: "var(--gray-700)" }}>
          {viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={nextMonth}>Next →</button>
      </div>
      <div className="card">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <th key={d} style={{ padding: "0.625rem", textAlign: "center", fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", letterSpacing: "0.06em", textTransform: "uppercase", borderBottom: "1px solid var(--gray-100)" }}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                {week.map((day, di) => {
                  const isToday = day && today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
                  const evs = day ? (dayEvents[day] || []) : [];
                  return (
                    <td key={di} style={{ padding: "0.375rem", verticalAlign: "top", height: 90, border: "1px solid var(--gray-100)", background: day ? "var(--white)" : "var(--gray-50)" }}>
                      {day && (
                        <>
                          <div style={{ fontSize: "0.875rem", fontWeight: isToday ? 700 : 400, color: isToday ? "var(--white)" : "var(--gray-600)", background: isToday ? "var(--navy)" : "transparent", width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.25rem" }}>
                            {day}
                          </div>
                          {evs.map((e) => (
                            <div key={e.id} onClick={() => onEventClick(e.id)}
                              style={{ background: "var(--navy-light)", color: "var(--navy)", borderRadius: "4px", padding: "0.125rem 0.375rem", fontSize: "0.7rem", fontWeight: 600, cursor: "pointer", marginBottom: "0.125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              title={e.name}>
                              {e.name}
                            </div>
                          ))}
                        </>
                      )}
                    </td>
                  );
                })}
                {week.length < 7 && Array.from({ length: 7 - week.length }, (_, i) => (
                  <td key={`empty-${i}`} style={{ background: "var(--gray-50)", border: "1px solid var(--gray-100)" }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EventList() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // "list" | "calendar"
  const [showPast, setShowPast] = useState(false);
  const navigate = useNavigate();
  const now = new Date();

  useEffect(() => {
    const q = query(collection(db, "events"), orderBy("date", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  const upcoming = events.filter((e) => {
    const d = getDate(e.date);
    return !d || d >= now;
  });
  const past = events.filter((e) => {
    const d = getDate(e.date);
    return d && d < now;
  }).reverse(); // most recent first

  if (loading) return <div className="loading">Loading events...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Events</h1>
          <p>{upcoming.length} upcoming · {past.length} past</p>
        </div>
        <div className="page-actions">
          <div style={{ display: "flex", border: "1.5px solid var(--gray-200)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            <button className="btn btn-sm" onClick={() => setView("list")}
              style={{ borderRadius: 0, background: view === "list" ? "var(--navy)" : "var(--white)", color: view === "list" ? "var(--white)" : "var(--gray-600)", border: "none" }}>
              ☰ List
            </button>
            <button className="btn btn-sm" onClick={() => setView("calendar")}
              style={{ borderRadius: 0, background: view === "calendar" ? "var(--navy)" : "var(--white)", color: view === "calendar" ? "var(--white)" : "var(--gray-600)", border: "none", borderLeft: "1px solid var(--gray-200)" }}>
              📅 Calendar
            </button>
          </div>
          <button className="btn btn-primary" onClick={() => navigate("/events/new")}>＋ New Event</button>
        </div>
      </div>

      {view === "calendar" ? (
        <CalendarView events={events} onEventClick={(id) => navigate(`/events/${id}`)} />
      ) : (
        <>
          {upcoming.length === 0 && past.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📅</div>
              <h3>No events yet</h3>
              <button className="btn btn-primary" style={{ marginTop: "1rem" }} onClick={() => navigate("/events/new")}>Create First Event</button>
            </div>
          ) : (
            <>
              {upcoming.length > 0 && (
                <>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.875rem" }}>Upcoming</div>
                  <div className="event-grid" style={{ marginBottom: "2rem" }}>
                    {upcoming.map((event) => (
                      <EventCard key={event.id} event={event} onClick={() => navigate(`/events/${event.id}`)} />
                    ))}
                  </div>
                </>
              )}

              {past.length > 0 && (
                <>
                  <button className="btn btn-ghost btn-sm" style={{ marginBottom: "0.875rem" }} onClick={() => setShowPast((s) => !s)}>
                    {showPast ? "▾" : "▸"} Past Events ({past.length})
                  </button>
                  {showPast && (
                    <div className="event-grid">
                      {past.map((event) => (
                        <EventCard key={event.id} event={event} onClick={() => navigate(`/events/${event.id}`)} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
