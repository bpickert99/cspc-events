import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, collection, query, where, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

const STATUS_BADGE = { pending: "badge-pending", yes: "badge-yes", no: "badge-no" };
const STATUS_LABEL = { pending: "Pending", yes: "Attending", no: "Declined" };

export default function TrackingDashboard() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [editingNote, setEditingNote] = useState(null);
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((s) => s.exists() && setEvent({ id: s.id, ...s.data() }));
    const q = query(collection(db, "guests"), where("eventId", "==", id));
    const unsub = onSnapshot(q, (snap) => {
      setGuests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [id]);

  const saveNote = async (guestId) => {
    await updateDoc(doc(db, "guests", guestId), { notes: noteText, updatedAt: serverTimestamp() });
    setEditingNote(null);
  };

  const overrideRsvp = async (guestId, status) => {
    const updates = { rsvpStatus: status, rsvpOverridden: true, updatedAt: serverTimestamp() };
    if (status === "yes") updates.rsvpSubmittedAt = serverTimestamp();
    await updateDoc(doc(db, "guests", guestId), updates);
  };

  if (!event) return <div className="loading">Loading...</div>;

  const total = guests.length;
  const sent = guests.filter((g) => g.emailSent).length;
  const opened = guests.filter((g) => g.emailOpened).length;
  const bounced = guests.filter((g) => g.emailBounced).length;
  const attending = guests.filter((g) => g.rsvpStatus === "yes").length;
  const declined = guests.filter((g) => g.rsvpStatus === "no").length;
  const pending = guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length;
  const responded = attending + declined;
  // Response rate: responded / sent, capped at 100%, never includes plus ones
  const responseRate = sent > 0 ? Math.min(100, Math.round((responded / sent) * 100)) : 0;

  const eventTags = event.tags || [];

  const filtered = guests.filter((g) => {
    const name = `${g.firstName} ${g.lastName} ${g.email}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchFilter =
      filter === "all" ||
      (filter === "attending" && g.rsvpStatus === "yes") ||
      (filter === "declined" && g.rsvpStatus === "no") ||
      (filter === "pending" && (!g.rsvpStatus || g.rsvpStatus === "pending")) ||
      (filter === "opened" && g.emailOpened) ||
      (filter === "not-opened" && g.emailSent && !g.emailOpened) ||
      (filter === "not-sent" && !g.emailSent) ||
      (filter === "bounced" && g.emailBounced);
    const matchTag = filterTag === "all" || (g.tags || []).includes(filterTag);
    return matchSearch && matchFilter && matchTag;
  });

  const partBreakdown = (event.parts || []).map((part) => {
    const invited = guests.filter((g) => (g.invitedParts || []).includes(part.id));
    const att = guests.filter((g) => g.rsvpStatus === "yes" && (g.rsvpParts?.includes(part.id) ?? (g.invitedParts || []).includes(part.id)));
    return { part, invited: invited.length, attending: att.length };
  });

  return (
    <div>
      <div className="page-header">
        <div><h1>Tracking</h1><p>{event.name} · real-time RSVP monitoring</p></div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        {[
          { label: "Invited", value: total, color: "var(--navy)" },
          { label: "Emails Sent", value: sent, color: "var(--navy)" },
          { label: "Opened", value: opened, color: "var(--green)" },
          { label: "Responded", value: responded, color: "var(--navy)" },
          { label: "Attending", value: attending, color: "var(--green)" },
          { label: "Declined", value: declined, color: "var(--red)" },
          { label: "Pending", value: pending, color: "var(--amber)" },
          { label: "Response Rate", value: `${responseRate}%`, color: "var(--navy)" },
          { label: "Bounced", value: bounced, color: "var(--red)" },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-value" style={{ color: s.color, fontSize: typeof s.value === "string" ? "1.5rem" : "2rem" }}>{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {sent > 0 && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-body">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8125rem", color: "var(--gray-600)", marginBottom: "0.375rem" }}>
              <span>Response rate ({responded} of {sent} emailed)</span>
              <span>{responseRate}%</span>
            </div>
            <div className="progress-bar"><div className="progress-fill green" style={{ width: `${responseRate}%` }} /></div>
            {(event.parts || []).length > 1 && (
              <div style={{ marginTop: "1rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                {partBreakdown.map(({ part, invited, attending }) => (
                  <div key={part.id}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--gray-600)", marginBottom: "0.25rem" }}>{part.name}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--gray-400)" }}>{attending} attending / {invited} invited</div>
                    <div className="progress-bar" style={{ width: 120, marginTop: "0.25rem" }}>
                      <div className="progress-fill" style={{ width: invited > 0 ? `${Math.min(100, (attending / invited) * 100)}%` : "0%" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="guest-filters" style={{ flexWrap: "wrap" }}>
        <div className="search-input">
          <input className="form-input" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: "2rem", width: 200 }} />
        </div>
        <select className="form-select" style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All guests</option>
          <option value="attending">Attending</option>
          <option value="declined">Declined</option>
          <option value="pending">Pending response</option>
          <option value="opened">Opened email</option>
          <option value="not-opened">Sent, not opened</option>
          <option value="not-sent">Not yet sent</option>
          <option value="bounced">Bounced</option>
        </select>
        {eventTags.length > 0 && (
          <select className="form-select" style={{ width: "auto" }} value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
            <option value="all">All tags</option>
            {eventTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>{filtered.length} shown</span>
      </div>

      <div className="card">
        {loading ? <div className="loading">Loading...</div> : filtered.length === 0 ? (
          <div className="empty-state"><h3>No guests match your filter</h3></div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                {(event.parts || []).length > 1 && <th>Invited To</th>}
                {eventTags.length > 0 && <th>Tags</th>}
                <th>Email Status</th>
                <th>RSVP</th>
                {(event.parts || []).length > 1 && <th>Attending Parts</th>}
                <th title="Answers submitted through the RSVP form">RSVP Form Answers</th>
                <th>Notes</th>
                <th>Edit RSVP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{g.title ? `${g.title} ` : ""}{g.firstName} {g.lastName}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--gray-400)" }}>{g.email}</div>
                    {(g.plusOneLimit > 0 || g.plusOneEligible) && g.plusOneRsvpStatus !== "no" && (
                      <div style={{ fontSize: "0.7rem", color: "var(--gold-dark)", marginTop: "0.125rem" }}>
                        +1: {g.plusOneRsvpName || "—"} ({g.plusOneRsvpStatus === "yes" ? "attending" : "pending"})
                      </div>
                    )}
                  </td>
                  {(event.parts || []).length > 1 && (
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                        {(g.invitedParts || []).map((pid) => { const p = (event.parts || []).find((x) => x.id === pid); return p ? <span key={pid} className="tag" style={{ fontSize: "0.7rem" }}>{p.name}</span> : null; })}
                      </div>
                    </td>
                  )}
                  {eventTags.length > 0 && (
                    <td>
                      <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                        {(g.tags || []).map((tid) => { const tag = eventTags.find((t) => t.id === tid); return tag ? <span key={tid} style={{ padding: "0.125rem 0.5rem", borderRadius: "99px", background: tag.color + "22", fontSize: "0.7rem", fontWeight: 700, color: tag.color }}>{tag.name}</span> : null; })}
                      </div>
                    </td>
                  )}
                  <td>
                    {!g.emailSent ? <span className="badge badge-pending">Not sent</span>
                      : g.emailBounced ? <span className="badge badge-bounced">Bounced</span>
                      : g.emailOpened ? <span className="badge badge-opened">Opened</span>
                      : <span className="badge badge-sent">Sent</span>}
                    {g.rsvpOverridden && <div style={{ fontSize: "0.65rem", color: "var(--amber)", marginTop: "0.125rem" }}>Staff edited</div>}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[g.rsvpStatus] || "badge-pending"}`}>{STATUS_LABEL[g.rsvpStatus] || "Pending"}</span>
                    {g.rsvpSubmittedAt && <div style={{ fontSize: "0.65rem", color: "var(--gray-400)", marginTop: "0.125rem" }}>{(g.rsvpSubmittedAt.toDate ? g.rsvpSubmittedAt.toDate() : new Date(g.rsvpSubmittedAt)).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
                  </td>
                  {(event.parts || []).length > 1 && (
                    <td style={{ fontSize: "0.8125rem" }}>
                      {(g.rsvpParts || []).length > 0
                        ? (g.rsvpParts || []).map((pid) => (event.parts || []).find((p) => p.id === pid)?.name).filter(Boolean).join(", ")
                        : <span style={{ color: "var(--gray-400)" }}>—</span>}
                    </td>
                  )}
                  <td style={{ fontSize: "0.8125rem", maxWidth: 180 }}>
                    {g.rsvpData && Object.keys(g.rsvpData).length > 0
                      ? Object.entries(g.rsvpData).map(([k, v]) => (
                          <div key={k} style={{ marginBottom: "0.125rem" }}>
                            <span style={{ color: "var(--gray-400)", fontSize: "0.7rem" }}>{k}: </span>
                            <span>{String(v)}</span>
                          </div>
                        ))
                      : <span style={{ color: "var(--gray-300)" }}>—</span>}
                  </td>
                  <td style={{ minWidth: 140 }}>
                    {editingNote === g.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                        <textarea className="form-textarea" value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ minHeight: 60, fontSize: "0.8rem" }} />
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          <button className="btn btn-primary btn-sm" onClick={() => saveNote(g.id)}>Save</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditingNote(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "0.375rem", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "0.8125rem", color: g.notes ? "var(--gray-800)" : "var(--gray-400)", flex: 1 }}>{g.notes || "—"}</span>
                        <button className="btn btn-ghost btn-sm" style={{ padding: "0.125rem 0.375rem", flexShrink: 0 }} onClick={() => { setEditingNote(g.id); setNoteText(g.notes || ""); }}>✏️</button>
                      </div>
                    )}
                  </td>
                  <td>
                    <select className="form-select" style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
                      value={g.rsvpStatus || "pending"}
                      onChange={(e) => overrideRsvp(g.id, e.target.value)}>
                      <option value="pending">Pending</option>
                      <option value="yes">Attending</option>
                      <option value="no">Declined</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
