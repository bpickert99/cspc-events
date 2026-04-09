import React, { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc, getDoc, collection, query, where, getDocs, onSnapshot,
  deleteDoc, writeBatch, updateDoc, serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase";

// ─── Helpers ───────────────────────────────────────────────────────────────────
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
function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function daysSince(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// ─── Stat card ─────────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color, onClick, active }) {
  return (
    <div onClick={onClick}
      style={{ background: active ? "var(--navy)" : "var(--white)", border: `1.5px solid ${active ? "var(--navy)" : "var(--gray-100)"}`, borderRadius: "var(--radius-lg)", padding: "1rem 1.25rem", cursor: onClick ? "pointer" : "default", transition: "var(--transition)", flex: 1, minWidth: 100 }}
      onMouseEnter={(e) => { if (onClick) { e.currentTarget.style.borderColor = "var(--navy)"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
      onMouseLeave={(e) => { if (onClick) { e.currentTarget.style.borderColor = active ? "var(--navy)" : "var(--gray-100)"; e.currentTarget.style.transform = ""; } }}>
      <div style={{ fontSize: "1.75rem", fontWeight: 800, color: active ? "var(--white)" : (color || "var(--gray-800)"), lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: active ? "rgba(255,255,255,.8)" : "var(--gray-500)", marginTop: "0.25rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: active ? "rgba(255,255,255,.6)" : "var(--gray-400)", marginTop: "0.125rem" }}>{sub}</div>}
    </div>
  );
}

// ─── Part badge ────────────────────────────────────────────────────────────────
function PartBadge({ part, guest }) {
  const status = guest.rsvpStatus;
  let bg, color;
  if (!status || status === "pending") { bg = "var(--navy-light)"; color = "var(--navy)"; }
  else if (status === "no") { bg = "#FEE2E2"; color = "#B91C1C"; }
  else {
    const attending = (guest.rsvpParts?.length ? guest.rsvpParts : guest.invitedParts || []).includes(part.id);
    bg = attending ? "#DCFCE7" : "#FEE2E2";
    color = attending ? "#15803D" : "#B91C1C";
  }
  return <span style={{ padding: "0.125rem 0.5rem", borderRadius: 99, background: bg, fontSize: "0.7rem", fontWeight: 700, color, display: "inline-block" }}>{part.name}</span>;
}

// ─── Inline note editor ────────────────────────────────────────────────────────
function InlineNote({ guestId, value }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || "");
  const save = async () => {
    await updateDoc(doc(db, "guests", guestId), { notes: text, updatedAt: serverTimestamp() });
    setEditing(false);
  };
  if (editing) return (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "flex-start" }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)}
        style={{ flex: 1, minHeight: 52, fontSize: "0.8rem", padding: "4px 6px", border: "1.5px solid var(--navy)", borderRadius: 5, fontFamily: "inherit", resize: "none" }} autoFocus />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <button className="btn btn-primary btn-sm" onClick={save}>✓</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setText(value || ""); setEditing(false); }}>✕</button>
      </div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: "0.25rem", alignItems: "flex-start", cursor: "text" }} onClick={() => setEditing(true)}>
      <span style={{ fontSize: "0.8rem", color: text ? "var(--gray-700)" : "var(--gray-300)", flex: 1, fontStyle: text ? "normal" : "italic" }}>{text || "Add note..."}</span>
      <span style={{ fontSize: "0.65rem", color: "var(--gray-300)", flexShrink: 0 }}>✏️</span>
    </div>
  );
}

// ─── RSVP override dropdown ────────────────────────────────────────────────────
function RsvpOverride({ guestId, value }) {
  const [status, setStatus] = useState(value || "pending");
  const onChange = async (e) => {
    const v = e.target.value;
    setStatus(v);
    await updateDoc(doc(db, "guests", guestId), {
      rsvpStatus: v, rsvpOverridden: true,
      ...(v === "yes" || v === "no" ? { rsvpSubmittedAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
    });
  };
  const colors = { pending: "var(--amber)", yes: "var(--green)", no: "var(--red)" };
  return (
    <select value={status} onChange={onChange}
      style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", border: `1.5px solid ${colors[status]}`, borderRadius: 6, background: "white", color: colors[status], fontWeight: 700, cursor: "pointer" }}>
      <option value="pending">Pending</option>
      <option value="yes">Attending</option>
      <option value="no">Declined</option>
    </select>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────
export default function EventDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [filterPart, setFilterPart] = useState("all");
  const [filterTag, setFilterTag] = useState("all");

  // Real-time guest updates
  useEffect(() => {
    getDoc(doc(db, "events", id)).then((snap) => {
      if (snap.exists()) setEvent({ id: snap.id, ...snap.data() });
      setLoading(false);
    });
    const q = query(collection(db, "guests"), where("eventId", "==", id));
    const unsub = onSnapshot(q, (snap) => {
      setGuests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [id]);

  const deleteEvent = async () => {
    if (!confirm(`Permanently delete "${event?.name}" and all ${guests.length} guest records? This cannot be undone.`)) return;
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

  const toggleSort = (field) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  if (loading) return <div className="loading">Loading...</div>;
  if (!event) return <div className="error-msg">Event not found.</div>;

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const getDietary = (g) => g.rsvpData
    ? Object.entries(g.rsvpData).find(([k]) => k.toLowerCase().includes("dietary") && !k.toLowerCase().includes("plus"))?.[1] || ""
    : "";
  const getPlusOneDietary = (g) => g.rsvpData
    ? Object.entries(g.rsvpData).find(([k]) => k.toLowerCase().includes("dietary") && k.toLowerCase().includes("plus"))?.[1] || ""
    : "";

  // ─── Stats ─────────────────────────────────────────────────────────────────
  const total = guests.length;
  const primaryAttending = guests.filter((g) => g.rsvpStatus === "yes").length;
  const plusOnesAttending = guests.filter((g) => g.rsvpStatus === "yes" && g.plusOneRsvpStatus === "yes").length;
  // Attending = real headcount (primary + confirmed plus ones)
  const attending = primaryAttending + plusOnesAttending;
  const declined = guests.filter((g) => g.rsvpStatus === "no").length;
  const pending = guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length;
  const sent = guests.filter((g) => g.emailSent).length;
  const opened = guests.filter((g) => g.emailOpened).length;
  const responded = primaryAttending + declined;
  const responseRate = sent > 0 ? Math.min(100, Math.round((responded / sent) * 100)) : 0;
  const needsFollowUp = guests.filter((g) => g.emailSent && (!g.rsvpStatus || g.rsvpStatus === "pending") && daysSince(g.emailSentAt) >= 3);

  const eventTags = event.tags || [];
  const multiPart = (event.parts || []).length > 1;

  // ─── Part breakdown ─────────────────────────────────────────────────────────
  const partBreakdown = (event.parts || []).map((part) => {
    const inv = guests.filter((g) => (g.invitedParts || []).includes(part.id));
    const att = guests.filter((g) => g.rsvpStatus === "yes" && (g.rsvpParts?.includes(part.id) ?? (g.invitedParts || []).includes(part.id)));
    const plusOnes = att.filter((g) => g.plusOneRsvpStatus === "yes").length;
    return { part, invited: inv.length, attending: att.length, plusOnes, headcount: att.length + plusOnes };
  });

  // ─── Filter guests ──────────────────────────────────────────────────────────
  const filterFn = (g) => {
    if (activeFilter === "dietary") return (g.rsvpStatus === "yes") && (getDietary(g) || getPlusOneDietary(g));
    if (activeFilter === "attending") return g.rsvpStatus === "yes";
    if (activeFilter === "declined") return g.rsvpStatus === "no";
    if (activeFilter === "pending") return !g.rsvpStatus || g.rsvpStatus === "pending";
    if (activeFilter === "followup") return g.emailSent && (!g.rsvpStatus || g.rsvpStatus === "pending") && daysSince(g.emailSentAt) >= 3;
    if (activeFilter === "notsent") return !g.emailSent;
    if (activeFilter === "opened") return g.emailOpened;
    return true;
  };

  const searchFn = (g) => {
    if (!search) return true;
    const hay = `${g.title} ${g.firstName} ${g.lastName} ${g.email} ${g.staffPoc}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  };

  const partFn = (g) => filterPart === "all" || (g.invitedParts || []).includes(filterPart);
  const tagFn = (g) => filterTag === "all" || (g.tags || []).includes(filterTag);

  const filtered = guests.filter((g) => filterFn(g) && searchFn(g) && partFn(g) && tagFn(g));

  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    if (sortField === "name") { va = `${a.lastName} ${a.firstName}`.toLowerCase(); vb = `${b.lastName} ${b.firstName}`.toLowerCase(); }
    else if (sortField === "poc") { va = (a.staffPoc || "zzz").toLowerCase(); vb = (b.staffPoc || "zzz").toLowerCase(); }
    else if (sortField === "rsvp") { va = a.rsvpSubmittedAt?.seconds || 0; vb = b.rsvpSubmittedAt?.seconds || 0; }
    else if (sortField === "sent") { va = a.emailSentAt?.seconds || 0; vb = b.emailSentAt?.seconds || 0; }
    else { va = ""; vb = ""; }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const SortTh = ({ field, label }) => (
    <th onClick={() => toggleSort(field)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
        {label}
        <span style={{ fontSize: "0.6rem", color: sortField === field ? "var(--navy)" : "var(--gray-300)" }}>
          {sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );

  const filterBtn = (key, label, count, color) => (
    <button onClick={() => setActiveFilter(key)}
      style={{ padding: "0.375rem 0.875rem", borderRadius: 99, fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", border: "1.5px solid", transition: "var(--transition)", borderColor: activeFilter === key ? (color || "var(--navy)") : "var(--gray-200)", background: activeFilter === key ? (color || "var(--navy)") : "white", color: activeFilter === key ? "white" : "var(--gray-600)" }}>
      {label} {count !== undefined && <span style={{ fontSize: "0.7rem", marginLeft: "0.2rem", opacity: 0.85 }}>({count})</span>}
    </button>
  );

  // Dietary summary
  const dietaryGuests = guests.filter((g) => g.rsvpStatus === "yes" && (getDietary(g) || getPlusOneDietary(g)));

  const isPast = event.date && (event.date.toDate ? event.date.toDate() : new Date(event.date)) < new Date();

  return (
    <div>
      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", marginBottom: "0.25rem" }}>
            {isPast && <span style={{ background: "var(--gray-100)", color: "var(--gray-500)", fontSize: "0.7rem", fontWeight: 700, padding: "0.125rem 0.5rem", borderRadius: 99, textTransform: "uppercase", letterSpacing: "0.06em" }}>Past</span>}
            <h1 style={{ marginBottom: 0 }}>{event.name}</h1>
          </div>
          <p>{formatDate(event.date)}{event.location ? ` · ${event.location.split(",")[0]}` : ""}</p>
          {multiPart && (
            <div style={{ display: "flex", gap: "0.375rem", marginTop: "0.375rem", flexWrap: "wrap" }}>
              {event.parts.map((p) => (
                <span key={p.id} style={{ fontSize: "0.8rem", color: "var(--gray-500)" }}>
                  {p.name}{p.startTime ? ` ${fmt24(p.startTime)}` : ""}{p.endTime ? ` – ${fmt24(p.endTime)}` : ""}
                </span>
              )).reduce((acc, el, i) => [...acc, i > 0 ? <span key={`sep-${i}`} style={{ color: "var(--gray-300)" }}>·</span> : null, el], [])}
            </div>
          )}
        </div>
        <div className="page-actions">
          <Link to={`/events/${id}/guests`} className="btn btn-secondary btn-sm">👥 Guests</Link>
          <Link to={`/events/${id}/invitations`} className="btn btn-secondary btn-sm">✉️ Invitations</Link>
          {event.hasSeating && <Link to={`/events/${id}/seating`} className="btn btn-secondary btn-sm">🪑 Seating</Link>}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/events/${id}/edit`)}>Edit</button>
          <button className="btn btn-danger btn-sm" onClick={deleteEvent} disabled={deleting}>{deleting ? "Deleting…" : "Delete"}</button>
        </div>
      </div>

      {/* ─── Stats ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <Stat label="Invited" value={total} onClick={() => setActiveFilter("all")} active={activeFilter === "all"} />
        <Stat label="Attending" value={attending} sub={plusOnesAttending > 0 ? `${primaryAttending} guests + ${plusOnesAttending} plus one${plusOnesAttending !== 1 ? "s" : ""}` : `${primaryAttending} guests`} color="var(--green)" onClick={() => setActiveFilter("attending")} active={activeFilter === "attending"} />
        <Stat label="Pending" value={pending} color="var(--amber)" onClick={() => setActiveFilter("pending")} active={activeFilter === "pending"} />
        <Stat label="Declined" value={declined} color="var(--red)" onClick={() => setActiveFilter("declined")} active={activeFilter === "declined"} />
        <Stat label="Response Rate" value={`${responseRate}%`} sub={`${responded} of ${sent} emailed`} color="var(--navy)" />
        {needsFollowUp.length > 0 && (
          <Stat label="Follow-Up Needed" value={needsFollowUp.length} sub="sent 3+ days ago" color="var(--amber)" onClick={() => setActiveFilter("followup")} active={activeFilter === "followup"} />
        )}
      </div>

      {/* ─── Per-part breakdown ───────────────────────────────────────────── */}
      {multiPart && (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
          {partBreakdown.map(({ part, invited, attending, plusOnes, headcount }) => (
            <div key={part.id} style={{ flex: 1, minWidth: 160, background: "var(--white)", border: "1px solid var(--gray-100)", borderRadius: "var(--radius-lg)", padding: "0.875rem 1rem" }}>
              <div style={{ fontWeight: 700, color: "var(--navy)", marginBottom: "0.5rem", fontSize: "0.9375rem" }}>{part.name}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--gray-500)", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Invited</span><strong style={{ color: "var(--gray-700)" }}>{invited}</strong></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Attending</span><strong style={{ color: "var(--green)" }}>{headcount}{plusOnes > 0 ? <span style={{ fontSize: "0.7rem", color: "var(--green)", fontWeight: 400 }}> ({attending}+{plusOnes})</span> : ""}</strong></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Dietary alert ────────────────────────────────────────────────── */}
      {dietaryGuests.length > 0 && (
        <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "var(--radius)", padding: "0.75rem 1rem", marginBottom: "1.25rem", fontSize: "0.875rem", color: "#92400E" }}>
          🍽 <strong>{dietaryGuests.length} attending guest{dietaryGuests.length !== 1 ? "s" : ""}</strong> {dietaryGuests.length === 1 ? "has" : "have"} dietary restrictions or allergies. <button className="btn btn-ghost btn-sm" style={{ color: "#92400E", fontSize: "0.8rem" }} onClick={() => setActiveFilter(activeFilter === "dietary" ? "all" : "dietary")}>{activeFilter === "dietary" ? "Show all →" : "View dietary →"}</button>
        </div>
      )}

      {/* ─── Guest table ──────────────────────────────────────────────────── */}
      <div className="card">
        <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--gray-100)", display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          {/* Quick filter pills */}
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
            {filterBtn("all", "All", total)}
            {filterBtn("attending", "Attending", attending, "var(--green)")}
            {filterBtn("pending", "Pending", pending, "var(--amber)")}
            {filterBtn("declined", "Declined", declined, "var(--red)")}
            {needsFollowUp.length > 0 && filterBtn("followup", "Follow-Up", needsFollowUp.length, "#D97706")}
            {filterBtn("notsent", "Not Sent", guests.filter((g) => !g.emailSent).length)}
            {filterBtn("opened", "Opened Email", opened, "var(--navy)")}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {/* Part filter */}
            {multiPart && (
              <select className="form-select" style={{ width: "auto", fontSize: "0.8125rem" }} value={filterPart} onChange={(e) => setFilterPart(e.target.value)}>
                <option value="all">All parts</option>
                {event.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            {/* Tag filter */}
            {eventTags.length > 0 && (
              <select className="form-select" style={{ width: "auto", fontSize: "0.8125rem" }} value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
                <option value="all">All tags</option>
                {eventTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {/* Search */}
            <input className="form-input" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)}
              style={{ width: 180, fontSize: "0.8125rem" }} />
            <span style={{ fontSize: "0.8rem", color: "var(--gray-400)", whiteSpace: "nowrap" }}>{sorted.length} shown</span>
          </div>
        </div>

        {guests.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👥</div>
            <h3>No guests yet</h3>
            <Link to={`/events/${id}/guests`} className="btn btn-primary" style={{ marginTop: "1rem" }}>Add Guests</Link>
          </div>
        ) : sorted.length === 0 ? (
          <div className="empty-state"><h3>No guests match this filter</h3></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <SortTh field="name" label="Name" />
                  {multiPart && <th>Parts</th>}
                  <th>Email</th>
                  <SortTh field="rsvp" label="RSVP" />
                  <th>Dietary</th>
                  <SortTh field="poc" label="POC" />
                  <SortTh field="sent" label="Email Sent" />
                  <th>Notes</th>
                  <th>Override</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((g) => {
                  const dietary = getDietary(g);
                  const plusOneDietary = getPlusOneDietary(g);
                  const daysAgo = g.emailSentAt ? daysSince(g.emailSentAt) : null;
                  const flagFollowUp = g.emailSent && (!g.rsvpStatus || g.rsvpStatus === "pending") && daysAgo >= 3;
                  const hasPlusOne = g.plusOneLimit > 0 || g.plusOneEligible;
                  const plusOneName = g.plusOneRsvpName || g.staffPlusOneNames?.filter(Boolean)[0] || "";
                  const colSpan = multiPart ? 9 : 8;

                  return (
                    <React.Fragment key={g.id}>
                      <tr key={g.id} style={{ background: flagFollowUp ? "#FFFBEB" : undefined }}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                            {flagFollowUp && <span title="Needs follow-up" style={{ marginRight: 4 }}>⚠️</span>}
                            {g.title ? `${g.title} ` : ""}{g.firstName} {g.lastName}
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--gray-400)" }}>{g.email}</div>
                          {(g.tags || []).length > 0 && (
                            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.2rem" }}>
                              {g.tags.map((tid) => { const tag = eventTags.find((t) => t.id === tid); return tag ? <span key={tid} style={{ padding: "0 0.375rem", borderRadius: 99, background: tag.color + "22", fontSize: "0.65rem", fontWeight: 700, color: tag.color }}>{tag.name}</span> : null; })}
                            </div>
                          )}
                        </td>
                        {multiPart && (
                          <td>
                            <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                              {(g.invitedParts || []).map((pid) => { const p = event.parts.find((x) => x.id === pid); return p ? <PartBadge key={pid} part={p} guest={g} /> : null; })}
                            </div>
                          </td>
                        )}
                        <td style={{ fontSize: "0.8rem" }}>
                          {!g.emailSent ? <span style={{ color: "var(--gray-400)" }}>Not sent</span>
                            : g.emailBounced ? <span className="badge badge-bounced">Bounced</span>
                            : g.emailOpened ? <span className="badge badge-opened">Opened</span>
                            : <span className="badge badge-sent">Sent</span>}
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                            <span className={`badge badge-${g.rsvpStatus || "pending"}`} style={{ fontSize: "0.75rem" }}>
                              {g.rsvpStatus === "yes" ? "Attending" : g.rsvpStatus === "no" ? "Declined" : "Pending"}
                            </span>
                            {g.rsvpSubmittedAt && <span style={{ fontSize: "0.7rem", color: "var(--gray-400)" }}>{fmtDate(g.rsvpSubmittedAt)}</span>}
                            {g.rsvpOverridden && <span title="Staff edited" style={{ fontSize: "0.65rem", color: "var(--amber)" }}>★</span>}
                          </div>
                        </td>
                        <td style={{ fontSize: "0.8rem", maxWidth: 160 }}>
                          {dietary ? <span style={{ color: "var(--amber)", fontWeight: 600 }}>🍽 {dietary}</span> : <span style={{ color: "var(--gray-300)" }}>—</span>}
                        </td>
                        <td style={{ fontSize: "0.8rem", color: "var(--gray-500)" }}>{g.staffPoc || "—"}</td>
                        <td style={{ fontSize: "0.75rem", color: "var(--gray-400)", whiteSpace: "nowrap" }}>
                          {g.emailSentAt ? (
                            <div>
                              <div>{fmtDate(g.emailSentAt)}</div>
                              {daysAgo !== null && <div style={{ color: flagFollowUp ? "var(--amber)" : "var(--gray-300)" }}>{daysAgo === 0 ? "today" : `${daysAgo}d ago`}</div>}
                            </div>
                          ) : "—"}
                        </td>
                        <td style={{ minWidth: 140 }}>
                          <InlineNote guestId={g.id} value={g.notes} />
                        </td>
                        <td>
                          <RsvpOverride guestId={g.id} value={g.rsvpStatus} />
                        </td>
                      </tr>
                      {/* Plus-one sub-row */}
                      {hasPlusOne && (
                        <tr key={`${g.id}_plus`} style={{ background: "#FFFBEB", borderLeft: "3px solid var(--gold)" }}>
                          <td style={{ paddingLeft: "2rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ color: "var(--gold-dark)", fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase" }}>＋1</span>
                              {plusOneName
                                ? <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--gray-700)" }}>{plusOneName}</span>
                                : <span style={{ fontSize: "0.8rem", color: "var(--gray-400)", fontStyle: "italic" }}>
                                    {g.plusOneRsvpStatus === "no" ? "Not bringing a guest" : "Name not provided"}
                                  </span>}
                            </div>
                            <div style={{ fontSize: "0.72rem", color: "var(--gray-400)", paddingLeft: "1.5rem" }}>of {g.firstName} {g.lastName}</div>
                          </td>
                          {multiPart && <td />}
                          <td />
                          <td>
                            <span className={`badge badge-${g.plusOneRsvpStatus || "pending"}`} style={{ fontSize: "0.72rem" }}>
                              {g.plusOneRsvpStatus === "yes" ? "Attending" : g.plusOneRsvpStatus === "no" ? "Declined" : "Pending"}
                            </span>
                          </td>
                          <td style={{ fontSize: "0.8rem" }}>
                            {plusOneDietary ? <span style={{ color: "var(--amber)", fontWeight: 600 }}>🍽 {plusOneDietary}</span> : <span style={{ color: "var(--gray-300)" }}>—</span>}
                          </td>
                          <td colSpan={4} />
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Quick links ──────────────────────────────────────────────────── */}
      <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        <Link to={`/events/${id}/guests`} className="btn btn-secondary">👥 Manage Guests</Link>
        <Link to={`/events/${id}/invitations`} className="btn btn-secondary">✉️ Send Invitations</Link>
        {event.hasSeating && <Link to={`/events/${id}/seating`} className="btn btn-secondary">🪑 Seating Manager</Link>}
      </div>
    </div>
  );
}
