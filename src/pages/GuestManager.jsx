import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc, addDoc, updateDoc,
  deleteDoc, getDoc, serverTimestamp, writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { v4 as uuid } from "uuid";

const RSVP_STATUS_LABELS = { pending: "Pending", yes: "Attending", no: "Declined", partial: "Partial" };
const RSVP_BADGE = { pending: "badge-pending", yes: "badge-yes", no: "badge-no", partial: "badge-partial" };

const PLUS_ONE_OPTIONS = [
  { value: "0", label: "No plus one" },
  { value: "1", label: "1 guest" },
  { value: "2", label: "2 guests" },
  { value: "3", label: "3 guests" },
  { value: "-1", label: "Unlimited" },
];

const TAG_COLORS = [
  "#1B2B6B", "#C9A84C", "#38A169", "#E53E3E",
  "#7C3AED", "#0D9488", "#D97706", "#DB2777",
];

// ─── Inline tag creator ────────────────────────────────────────────────────────
function NewTagForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const inputRef = useRef();
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ id: uuid(), name: name.trim(), color });
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--white)", border: "1.5px solid var(--navy)", borderRadius: "var(--radius)", padding: "0.375rem 0.625rem", boxShadow: "var(--shadow-sm)" }}>
      <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)}
        placeholder="Tag name..." maxLength={30}
        style={{ border: "none", outline: "none", fontSize: "0.875rem", width: 120, color: "var(--gray-800)" }} />
      <div style={{ display: "flex", gap: "0.25rem" }}>
        {TAG_COLORS.map((c) => (
          <button key={c} type="button"
            onClick={() => setColor(c)}
            style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: color === c ? "2.5px solid var(--gray-800)" : "2px solid transparent", cursor: "pointer", flexShrink: 0 }} />
        ))}
      </div>
      <div style={{ display: "inline-flex", alignItems: "center", padding: "0.125rem 0.5rem", borderRadius: "99px", background: color + "22", fontSize: "0.75rem", fontWeight: 700, color, minWidth: 40, justifyContent: "center" }}>
        {name || "Preview"}
      </div>
      <button type="submit" className="btn btn-primary btn-sm">Add</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
    </form>
  );
}

// ─── Guest modal ────────────────────────────────────────────────────────────────
function GuestModal({ event, guest, onClose, onSave }) {
  const isEdit = Boolean(guest);
  const eventTags = event.tags || [];
  const [form, setForm] = useState({
    firstName: guest?.firstName || "",
    lastName: guest?.lastName || "",
    title: guest?.title || "",
    email: guest?.email || "",
    invitedParts: guest?.invitedParts || (event.parts || []).map((p) => p.id),
    plusOneLimit: String(guest?.plusOneLimit ?? (guest?.plusOneEligible ? "1" : "0")),
    staffPoc: guest?.staffPoc || "",
    notes: guest?.notes || "",
    tags: guest?.tags || [],
    rsvpStatus: guest?.rsvpStatus || "pending",
    rsvpParts: guest?.rsvpParts || [],
    plusOneRsvpStatus: guest?.plusOneRsvpStatus || "pending",
  });
  const [saving, setSaving] = useState(false);
  const set = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));
  const togglePart = (pid) => setForm((s) => ({ ...s, invitedParts: s.invitedParts.includes(pid) ? s.invitedParts.filter((x) => x !== pid) : [...s.invitedParts, pid] }));
  const toggleTag = (tid) => setForm((s) => ({ ...s, tags: s.tags.includes(tid) ? s.tags.filter((x) => x !== tid) : [...s.tags, tid] }));
  const hasPlus = parseInt(form.plusOneLimit, 10) !== 0;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    await onSave(form, guest?.id);
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h3>{isEdit ? "Edit Guest" : "Add Guest"}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label>First Name <span className="required">*</span></label>
                <input className="form-input" required value={form.firstName} onChange={set("firstName")} />
              </div>
              <div className="form-group">
                <label>Last Name <span className="required">*</span></label>
                <input className="form-input" required value={form.lastName} onChange={set("lastName")} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Title / Honorific</label>
                <input className="form-input" value={form.title} onChange={set("title")} placeholder="Senator, Ambassador, Mr., etc." />
              </div>
              <div className="form-group">
                <label>Email <span className="required">*</span></label>
                <input className="form-input" type="email" required value={form.email} onChange={set("email")} />
              </div>
            </div>
            <div className="form-group">
              <label>Staff POC</label>
              <input className="form-input" value={form.staffPoc} onChange={set("staffPoc")} placeholder="Who is managing this guest?" />
            </div>

            {(event.parts || []).length > 1 && (
              <div className="form-group">
                <label>Invited To</label>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {event.parts.map((p) => (
                    <label key={p.id} className="checkbox-label">
                      <input type="checkbox" checked={form.invitedParts.includes(p.id)} onChange={() => togglePart(p.id)} />
                      {p.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {eventTags.length > 0 && (
              <div className="form-group">
                <label>Tags</label>
                <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  {eventTags.map((tag) => (
                    <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                      style={{ padding: "0.25rem 0.75rem", borderRadius: "99px", fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer", background: form.tags.includes(tag.id) ? tag.color : tag.color + "22", color: form.tags.includes(tag.id) ? "white" : tag.color, border: `1.5px solid ${tag.color}`, transition: "var(--transition)" }}>
                      {form.tags.includes(tag.id) ? "✓ " : ""}{tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="form-group">
              <label>Plus One Allowance</label>
              <select className="form-select" value={form.plusOneLimit} onChange={set("plusOneLimit")}>
                {PLUS_ONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {hasPlus && <div className="form-hint">Guest will enter their plus one's name when they RSVP.</div>}
            </div>

            {isEdit && (
              <>
                <div className="divider" />
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>RSVP — Manual Override</div>
                <div className="form-row">
                  <div className="form-group">
                    <label>RSVP Status</label>
                    <select className="form-select" value={form.rsvpStatus} onChange={set("rsvpStatus")}>
                      <option value="pending">Pending</option>
                      <option value="yes">Attending</option>
                      <option value="partial">Partial</option>
                      <option value="no">Declined</option>
                    </select>
                  </div>
                  {hasPlus && (
                    <div className="form-group">
                      <label>Plus One Status</label>
                      <select className="form-select" value={form.plusOneRsvpStatus} onChange={set("plusOneRsvpStatus")}>
                        <option value="pending">Pending</option>
                        <option value="yes">Attending</option>
                        <option value="no">Not attending</option>
                      </select>
                    </div>
                  )}
                </div>
                {(form.rsvpStatus === "yes" || form.rsvpStatus === "partial") && (event.parts || []).length > 1 && (
                  <div className="form-group">
                    <label>Attending Parts</label>
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                      {event.parts.map((p) => (
                        <label key={p.id} className="checkbox-label" style={{ fontSize: "0.875rem" }}>
                          <input type="checkbox" checked={form.rsvpParts.includes(p.id)}
                            onChange={() => setForm((s) => ({ ...s, rsvpParts: s.rsvpParts.includes(p.id) ? s.rsvpParts.filter((x) => x !== p.id) : [...s.rsvpParts, p.id] }))} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="form-group" style={{ marginTop: "0.25rem" }}>
              <label>Internal Notes</label>
              <textarea className="form-textarea" value={form.notes} onChange={set("notes")} placeholder="Any relevant notes..." style={{ minHeight: 70 }} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Add Guest"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function GuestManager() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState("");
  const [filterPart, setFilterPart] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [quickTagMode, setQuickTagMode] = useState(null); // tag id being quick-applied
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const csvRef = useRef();

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((s) => s.exists() && setEvent({ id: s.id, ...s.data() }));
    const q = query(collection(db, "guests"), where("eventId", "==", id));
    const unsub = onSnapshot(q, (snap) => {
      setGuests(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, [id]);

  // ─── Tag management ──────────────────────────────────────────────────────────
  const addTag = async (tag) => {
    const newTags = [...(event.tags || []), tag];
    await updateDoc(doc(db, "events", id), { tags: newTags });
    setEvent((e) => ({ ...e, tags: newTags }));
    setShowNewTagForm(false);
  };

  const deleteTag = async (tagId) => {
    if (!confirm("Delete this tag? It will be removed from all guests.")) return;
    const newTags = (event.tags || []).filter((t) => t.id !== tagId);
    await updateDoc(doc(db, "events", id), { tags: newTags });
    setEvent((e) => ({ ...e, tags: newTags }));
    // Remove from all guests
    const affected = guests.filter((g) => (g.tags || []).includes(tagId));
    const batch = writeBatch(db);
    affected.forEach((g) => {
      batch.update(doc(db, "guests", g.id), { tags: (g.tags || []).filter((t) => t !== tagId) });
    });
    await batch.commit();
    if (quickTagMode === tagId) setQuickTagMode(null);
    if (filterTag === tagId) setFilterTag("all");
  };

  // Quick-tag: click a guest row to toggle a tag without opening the modal
  const handleQuickTag = async (guest) => {
    if (!quickTagMode) return;
    const currentTags = guest.tags || [];
    const newTags = currentTags.includes(quickTagMode)
      ? currentTags.filter((t) => t !== quickTagMode)
      : [...currentTags, quickTagMode];
    await updateDoc(doc(db, "guests", guest.id), { tags: newTags, updatedAt: serverTimestamp() });
  };

  // ─── Guest CRUD ──────────────────────────────────────────────────────────────
  const saveGuest = async (form, guestId) => {
    const limit = parseInt(form.plusOneLimit, 10);
    const data = { ...form, plusOneEligible: limit !== 0, plusOneLimit: limit, updatedAt: serverTimestamp() };
    if (guestId) {
      await updateDoc(doc(db, "guests", guestId), data);
    } else {
      await addDoc(collection(db, "guests"), {
        ...data, eventId: id, rsvpToken: uuid(), rsvpStatus: "pending",
        rsvpParts: [], rsvpData: {}, emailSent: false, emailOpened: false, emailBounced: false,
        createdAt: serverTimestamp(),
      });
    }
    setModal(null);
  };

  const deleteGuest = async (guestId) => {
    if (!confirm("Remove this guest?")) return;
    await deleteDoc(doc(db, "guests", guestId));
  };

  const importCSV = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = ev.target.result.split("\n").filter(Boolean);
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
      const batch = writeBatch(db);
      let count = 0;
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        const row = {};
        headers.forEach((h, j) => { row[h] = cells[j] || ""; });
        if (!row.email && !row.firstname) continue;
        const hasPlus = (row.plusone || "").toLowerCase() === "yes";
        const ref = doc(collection(db, "guests"));
        batch.set(ref, {
          eventId: id, firstName: row.firstname || "", lastName: row.lastname || "",
          title: row.title || "", email: row.email || "", staffPoc: row.staffpoc || "",
          invitedParts: (event?.parts || []).map((p) => p.id),
          plusOneEligible: hasPlus, plusOneLimit: hasPlus ? 1 : 0,
          tags: [], notes: row.notes || "",
          rsvpToken: uuid(), rsvpStatus: "pending", rsvpParts: [], rsvpData: {},
          emailSent: false, emailOpened: false, emailBounced: false, createdAt: serverTimestamp(),
        });
        count++;
      }
      await batch.commit();
      alert(`Imported ${count} guests.`);
    };
    reader.readAsText(file);
    csvRef.current.value = "";
  };

  const eventTags = event?.tags || [];
  const quickTag = quickTagMode ? eventTags.find((t) => t.id === quickTagMode) : null;

  const filtered = guests.filter((g) => {
    const name = `${g.title} ${g.firstName} ${g.lastName} ${g.email}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchPart = filterPart === "all" || (g.invitedParts || []).includes(filterPart);
    const matchStatus = filterStatus === "all" || g.rsvpStatus === filterStatus || (!g.rsvpStatus && filterStatus === "pending");
    const matchTag = filterTag === "all" || (g.tags || []).includes(filterTag);
    return matchSearch && matchPart && matchStatus && matchTag;
  });

  if (!event) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Guests</h1>
          <p>{event.name} · {guests.length} total</p>
        </div>
        <div className="page-actions">
          <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }} onChange={importCSV} />
          <button className="btn btn-secondary btn-sm" onClick={() => csvRef.current.click()}>⬆ Import CSV</button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>＋ Add Guest</button>
        </div>
      </div>

      {/* ─── Tag management bar ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card-body" style={{ padding: "0.875rem 1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>Tags</span>

            {eventTags.map((tag) => (
              <div key={tag.id} style={{ display: "flex", alignItems: "center", gap: 0 }}>
                <button
                  onClick={() => setQuickTagMode(quickTagMode === tag.id ? null : tag.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.3rem",
                    padding: "0.25rem 0.625rem", borderRadius: "99px 0 0 99px",
                    background: quickTagMode === tag.id ? tag.color : tag.color + "22",
                    color: quickTagMode === tag.id ? "white" : tag.color,
                    border: `1.5px solid ${tag.color}`, borderRight: "none",
                    fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer",
                    transition: "var(--transition)",
                  }}
                  title={quickTagMode === tag.id ? "Click guests to toggle this tag · click again to exit" : "Click to enter quick-tag mode"}>
                  {quickTagMode === tag.id ? "✦ " : ""}{tag.name}
                  {quickTagMode === tag.id && (
                    <span style={{ fontSize: "0.65rem", fontWeight: 400, marginLeft: "0.125rem" }}>
                      ({guests.filter((g) => (g.tags || []).includes(tag.id)).length})
                    </span>
                  )}
                </button>
                <button
                  onClick={() => deleteTag(tag.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 24, height: 24, borderRadius: "0 99px 99px 0",
                    background: tag.color + "22", color: tag.color,
                    border: `1.5px solid ${tag.color}`, borderLeft: "none",
                    fontSize: "0.65rem", cursor: "pointer", transition: "var(--transition)",
                  }}
                  title="Delete tag"
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#FEE2E2"; e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.borderColor = "var(--red)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = tag.color + "22"; e.currentTarget.style.color = tag.color; e.currentTarget.style.borderColor = tag.color; }}>
                  ✕
                </button>
              </div>
            ))}

            {showNewTagForm
              ? <NewTagForm onAdd={addTag} onCancel={() => setShowNewTagForm(false)} />
              : <button className="btn btn-ghost btn-sm" style={{ border: "1.5px dashed var(--gray-300)", color: "var(--gray-500)" }} onClick={() => setShowNewTagForm(true)}>＋ New Tag</button>
            }
          </div>

          {/* Quick-tag mode hint */}
          {quickTag && (
            <div style={{ marginTop: "0.625rem", padding: "0.5rem 0.75rem", background: quickTag.color + "15", border: `1px solid ${quickTag.color}44`, borderRadius: "var(--radius)", fontSize: "0.8125rem", color: quickTag.color, fontWeight: 600 }}>
              Quick-tag mode: <strong>{quickTag.name}</strong> — click any guest row to toggle this tag on or off.
              <button onClick={() => setQuickTagMode(null)} style={{ marginLeft: "0.75rem", background: "none", border: "none", color: quickTag.color, cursor: "pointer", fontWeight: 700, fontSize: "0.8125rem" }}>Done</button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Filters ────────────────────────────────────────────────────────── */}
      <div style={{ fontSize: "0.8rem", color: "var(--gray-400)", marginBottom: "1rem", background: "var(--gray-50)", padding: "0.5rem 0.875rem", borderRadius: "var(--radius)", border: "1px solid var(--gray-200)" }}>
        CSV: <code>First Name, Last Name, Title, Email, Staff POC, Plus One (yes/no), Notes</code>
      </div>

      <div className="guest-filters">
        <div className="search-input">
          <input className="form-input" placeholder="Search guests..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: "2.125rem" }} />
        </div>
        {(event.parts || []).length > 1 && (
          <select className="form-select" style={{ width: "auto" }} value={filterPart} onChange={(e) => setFilterPart(e.target.value)}>
            <option value="all">All parts</option>
            {event.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {eventTags.length > 0 && (
          <select className="form-select" style={{ width: "auto" }} value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
            <option value="all">All tags</option>
            {eventTags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <select className="form-select" style={{ width: "auto" }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="yes">Attending</option>
          <option value="partial">Partial</option>
          <option value="no">Declined</option>
        </select>
        <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>{filtered.length} shown</span>
      </div>

      {/* ─── Guest table ─────────────────────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div className="loading">Loading guests...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👥</div>
            <h3>{guests.length === 0 ? "No guests yet" : "No guests match filters"}</h3>
            {guests.length === 0 && <button className="btn btn-primary" style={{ marginTop: "1rem" }} onClick={() => setModal("add")}>Add First Guest</button>}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                {(event.parts || []).length > 1 && <th>Invited To</th>}
                <th>Plus One</th>
                {eventTags.length > 0 && <th>Tags</th>}
                <th>POC</th>
                <th>RSVP</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const limit = g.plusOneLimit ?? (g.plusOneEligible ? 1 : 0);
                const hasQuickTag = quickTagMode && (g.tags || []).includes(quickTagMode);
                return (
                  <tr key={g.id}
                    onClick={() => quickTagMode && handleQuickTag(g)}
                    style={{
                      cursor: quickTagMode ? "pointer" : "default",
                      background: quickTagMode
                        ? hasQuickTag ? (quickTag?.color + "18") : "transparent"
                        : undefined,
                      outline: quickTagMode && hasQuickTag ? `2px solid ${quickTag?.color}44` : undefined,
                    }}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--gray-800)" }}>{g.title ? `${g.title} ` : ""}{g.firstName} {g.lastName}</div>
                      {g.notes && <div style={{ fontSize: "0.75rem", color: "var(--gray-400)", marginTop: "0.125rem" }}>📝 {g.notes.slice(0, 55)}{g.notes.length > 55 ? "…" : ""}</div>}
                    </td>
                    <td style={{ fontSize: "0.875rem", color: "var(--gray-500)" }}>{g.email}</td>
                    {(event.parts || []).length > 1 && (
                      <td>
                        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                          {(g.invitedParts || []).map((pid) => {
                            const part = event.parts.find((p) => p.id === pid);
                            return part ? <span key={pid} className="tag" style={{ fontSize: "0.7rem" }}>{part.name}</span> : null;
                          })}
                        </div>
                      </td>
                    )}
                    <td style={{ fontSize: "0.875rem" }}>
                      {limit !== 0
                        ? <span style={{ color: "var(--gold-dark)", fontWeight: 600 }}>✓ {limit === -1 ? "Unlimited" : `Up to ${limit}`}{g.plusOneRsvpName ? <span style={{ display: "block", fontSize: "0.7rem", color: "var(--gray-400)", fontWeight: 400 }}>{g.plusOneRsvpName}</span> : null}</span>
                        : <span style={{ color: "var(--gray-300)" }}>—</span>}
                    </td>
                    {eventTags.length > 0 && (
                      <td>
                        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                          {(g.tags || []).map((tid) => {
                            const tag = eventTags.find((t) => t.id === tid);
                            return tag ? (
                              <span key={tid} style={{ display: "inline-flex", alignItems: "center", padding: "0.125rem 0.5rem", borderRadius: "99px", background: tag.color + "22", fontSize: "0.7rem", fontWeight: 700, color: tag.color }}>
                                {tag.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      </td>
                    )}
                    <td style={{ fontSize: "0.875rem", color: "var(--gray-500)" }}>{g.staffPoc || "—"}</td>
                    <td>
                      <span className={`badge ${RSVP_BADGE[g.rsvpStatus] || "badge-pending"}`}>
                        {RSVP_STATUS_LABELS[g.rsvpStatus] || "Pending"}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: "0.375rem" }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setModal(g)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => deleteGuest(g.id)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <GuestModal
          event={event}
          guest={modal === "add" ? null : modal}
          onClose={() => setModal(null)}
          onSave={saveGuest}
        />
      )}
    </div>
  );
}
