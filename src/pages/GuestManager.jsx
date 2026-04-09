import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  collection, query, where, onSnapshot, doc, addDoc, updateDoc,
  deleteDoc, getDoc, serverTimestamp, writeBatch
} from "firebase/firestore";
import { db } from "../firebase";
import { v4 as uuid } from "uuid";

const RSVP_STATUS_LABELS = { pending: "Pending", yes: "Attending", no: "Declined" };
const RSVP_BADGE = { pending: "badge-pending", yes: "badge-yes", no: "badge-no" };

const PLUS_ONE_OPTIONS = [
  { value: "0", label: "No plus one" },
  { value: "1", label: "1 guest" },
  { value: "2", label: "2 guests" },
  { value: "3", label: "3 guests" },
  { value: "-1", label: "Unlimited" },
];

// ─── CSV Field definitions ─────────────────────────────────────────────────────
const CSV_FIELDS = [
  { key: "firstName",  label: "First Name",       required: true },
  { key: "lastName",   label: "Last Name",         required: false },
  { key: "title",      label: "Title / Honorific", required: false },
  { key: "email",      label: "Email",             required: true },
  { key: "staffPoc",   label: "Staff POC",         required: false },
  { key: "plusOne",    label: "Plus One (yes/no)", required: false },
  { key: "notes",      label: "Notes",             required: false },
  { key: "ignore",     label: "— Ignore —",        required: false },
];

// ─── CSV Column Mapper Modal ───────────────────────────────────────────────────
function CSVMapperModal({ csvText, onConfirm, onCancel }) {
  const lines = csvText.split("\n").filter(Boolean);
  const rawHeaders = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const previewRows = lines.slice(1, 4).map((l) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, "")));

  // Auto-detect mappings
  const autoMap = (h) => {
    const norm = h.toLowerCase().replace(/[\s_-]/g, "");
    if (norm.includes("first")) return "firstName";
    if (norm.includes("last")) return "lastName";
    if (norm.includes("title") || norm.includes("honor")) return "title";
    if (norm.includes("email")) return "email";
    if (norm.includes("poc") || norm.includes("staff")) return "staffPoc";
    if (norm.includes("plus") || norm.includes("guest")) return "plusOne";
    if (norm.includes("note")) return "notes";
    return "ignore";
  };

  const [mappings, setMappings] = useState(() => rawHeaders.map(autoMap));
  const [importing, setImporting] = useState(false);

  const missingRequired = CSV_FIELDS.filter((f) => f.required && !mappings.includes(f.key)).map((f) => f.label);

  const handleConfirm = async () => {
    if (missingRequired.length > 0) {
      alert(`Please map required fields: ${missingRequired.join(", ")}`);
      return;
    }
    setImporting(true);
    const rows = lines.slice(1).map((line) => {
      const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const row = {};
      mappings.forEach((fieldKey, i) => {
        if (fieldKey && fieldKey !== "ignore") row[fieldKey] = cells[i] || "";
      });
      return row;
    }).filter((r) => r.firstName || r.email);
    onConfirm(rows);
  };

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 720, width: "95vw" }}>
        <div className="modal-header">
          <h3>Map CSV Columns</h3>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: "0.875rem", color: "var(--gray-500)", marginBottom: "1.25rem" }}>
            We detected {rawHeaders.length} column{rawHeaders.length !== 1 ? "s" : ""}. Match each column to a guest field, or choose "Ignore" to skip it.
          </p>

          {missingRequired.length > 0 && (
            <div style={{ background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: "var(--radius)", padding: "0.625rem 0.875rem", fontSize: "0.8125rem", color: "#92400E", marginBottom: "1rem" }}>
              ⚠️ Required fields not yet mapped: <strong>{missingRequired.join(", ")}</strong>
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "var(--gray-50)", borderBottom: "2px solid var(--gray-200)" }}>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 700, color: "var(--gray-600)", whiteSpace: "nowrap" }}>CSV Column</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 700, color: "var(--gray-600)" }}>Maps to</th>
                  {previewRows.map((_, i) => (
                    <th key={i} style={{ padding: "0.5rem 0.75rem", textAlign: "left", fontWeight: 700, color: "var(--gray-400)", fontSize: "0.75rem" }}>Row {i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawHeaders.map((header, col) => (
                  <tr key={col} style={{ borderBottom: "1px solid var(--gray-100)" }}>
                    <td style={{ padding: "0.5rem 0.75rem", fontWeight: 600, color: "var(--gray-700)", whiteSpace: "nowrap" }}>{header}</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <select
                        value={mappings[col]}
                        onChange={(e) => {
                          const next = [...mappings];
                          next[col] = e.target.value;
                          setMappings(next);
                        }}
                        style={{ padding: "0.25rem 0.5rem", border: "1.5px solid var(--gray-200)", borderRadius: "var(--radius)", fontSize: "0.8125rem", background: mappings[col] === "ignore" ? "var(--gray-50)" : "var(--navy-xlight)", color: mappings[col] === "ignore" ? "var(--gray-400)" : "var(--navy)", fontWeight: mappings[col] === "ignore" ? 400 : 600 }}>
                        {CSV_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}{f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    {previewRows.map((row, ri) => (
                      <td key={ri} style={{ padding: "0.5rem 0.75rem", color: "var(--gray-500)", fontSize: "0.8rem", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {row[col] || <span style={{ color: "var(--gray-300)" }}>—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "1rem", fontSize: "0.8125rem", color: "var(--gray-400)" }}>
            {lines.length - 1} guest{lines.length - 2 !== 0 ? "s" : ""} will be imported · <span style={{ color: "var(--red)" }}>*</span> Required
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={handleConfirm} disabled={importing}>
            {importing ? "Importing..." : `Import ${lines.length - 1} Guest${lines.length - 2 !== 0 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const TAG_COLORS = ["#1B2B6B","#C9A84C","#38A169","#E53E3E","#7C3AED","#0D9488","#D97706","#DB2777"];

function PartTag({ part, guest }) {
  const status = guest.rsvpStatus;
  let bg, color;
  if (!status || status === "pending") { bg = "var(--navy-light)"; color = "var(--navy)"; }
  else if (status === "no") { bg = "#FEE2E2"; color = "#B91C1C"; }
  else {
    const attending = (guest.rsvpParts?.length ? guest.rsvpParts : guest.invitedParts || []).includes(part.id);
    bg = attending ? "#DCFCE7" : "#FEE2E2";
    color = attending ? "#15803D" : "#B91C1C";
  }
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "0.1875rem 0.5625rem", borderRadius: "99px", background: bg, fontSize: "0.7rem", fontWeight: 700, color }}>{part.name}</span>;
}

function NewTagForm({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const inputRef = useRef();
  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = (e) => { e.preventDefault(); if (!name.trim()) return; onAdd({ id: uuid(), name: name.trim(), color }); };
  return (
    <form onSubmit={submit} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--white)", border: "1.5px solid var(--navy)", borderRadius: "var(--radius)", padding: "0.375rem 0.625rem", boxShadow: "var(--shadow-sm)" }}>
      <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tag name..." maxLength={30} style={{ border: "none", outline: "none", fontSize: "0.875rem", width: 120 }} />
      <div style={{ display: "flex", gap: "0.25rem" }}>
        {TAG_COLORS.map((c) => <button key={c} type="button" onClick={() => setColor(c)} style={{ width: 18, height: 18, borderRadius: "50%", background: c, border: color === c ? "2.5px solid var(--gray-800)" : "2px solid transparent", cursor: "pointer" }} />)}
      </div>
      <div style={{ padding: "0.125rem 0.5rem", borderRadius: "99px", background: color + "22", fontSize: "0.75rem", fontWeight: 700, color, minWidth: 40, textAlign: "center" }}>{name || "Preview"}</div>
      <button type="submit" className="btn btn-primary btn-sm">Add</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>✕</button>
    </form>
  );
}

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
    staffPlusOneNames: guest?.staffPlusOneNames || [""],
    staffPoc: guest?.staffPoc || "",
    notes: guest?.notes || "",
    tags: guest?.tags || [],
    rsvpStatus: guest?.rsvpStatus || "pending",
    rsvpParts: guest?.rsvpParts || [],
    plusOneRsvpStatus: guest?.plusOneRsvpStatus || "pending",
    plusOneRsvpName: guest?.plusOneRsvpName || "",
    dietary: guest?.rsvpData?.["Dietary restrictions"] || guest?.rsvpData?.["dietary restrictions"] || "",
    plusOneDietary: guest?.rsvpData?.["Plus one dietary restrictions"] || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.value }));
  const togglePart = (pid) => setForm((s) => ({ ...s, invitedParts: s.invitedParts.includes(pid) ? s.invitedParts.filter((x) => x !== pid) : [...s.invitedParts, pid] }));
  const toggleTag = (tid) => setForm((s) => ({ ...s, tags: s.tags.includes(tid) ? s.tags.filter((x) => x !== tid) : [...s.tags, tid] }));
  const toggleRsvpPart = (pid) => setForm((s) => ({ ...s, rsvpParts: s.rsvpParts.includes(pid) ? s.rsvpParts.filter((x) => x !== pid) : [...s.rsvpParts, pid] }));
  const limit = parseInt(form.plusOneLimit, 10);
  const hasPlus = limit !== 0;

  const syncNamesToLimit = (val) => {
    const n = parseInt(val, 10);
    setForm((s) => {
      let names = [...s.staffPlusOneNames];
      if (n > 0) { while (names.length < n) names.push(""); names = names.slice(0, n); }
      else if (n === -1) { if (!names.length) names = [""]; }
      else { names = [""]; }
      return { ...s, plusOneLimit: val, staffPlusOneNames: names };
    });
  };

  const submit = async (e) => { e.preventDefault(); setSaving(true); await onSave(form, guest?.id); setSaving(false); };

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
              <div className="form-group"><label>First Name <span className="required">*</span></label><input className="form-input" required value={form.firstName} onChange={set("firstName")} /></div>
              <div className="form-group"><label>Last Name <span className="required">*</span></label><input className="form-input" required value={form.lastName} onChange={set("lastName")} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Title</label><input className="form-input" value={form.title} onChange={set("title")} placeholder="Senator, Ambassador, Mr., etc." /></div>
              <div className="form-group"><label>Email <span className="required">*</span></label><input className="form-input" type="email" required value={form.email} onChange={set("email")} /></div>
            </div>
            <div className="form-group"><label>Staff POC</label><input className="form-input" value={form.staffPoc} onChange={set("staffPoc")} placeholder="Who is managing this guest?" /></div>

            {(event.parts || []).length > 1 && (
              <div className="form-group">
                <label>Invited To</label>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {event.parts.map((p) => <label key={p.id} className="checkbox-label"><input type="checkbox" checked={form.invitedParts.includes(p.id)} onChange={() => togglePart(p.id)} />{p.name}</label>)}
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
              <select className="form-select" value={form.plusOneLimit} onChange={(e) => syncNamesToLimit(e.target.value)}>
                {PLUS_ONE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {hasPlus && (
              <div style={{ background: "var(--gold-light)", border: "1px solid rgba(201,168,76,.3)", borderRadius: "var(--radius)", padding: "0.875rem", marginBottom: "0.875rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.5rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Plus One Name(s) — optional, staff can pre-fill</div>
                {form.staffPlusOneNames.map((name, i) => (
                  <input key={i} className="form-input" value={name} onChange={(e) => { const n = [...form.staffPlusOneNames]; n[i] = e.target.value; setForm((s) => ({ ...s, staffPlusOneNames: n })); }} placeholder={`Plus one ${i + 1} name`} style={{ marginBottom: "0.375rem" }} />
                ))}
                {limit === -1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setForm((s) => ({ ...s, staffPlusOneNames: [...s.staffPlusOneNames, ""] }))}>＋ Add another</button>}
              </div>
            )}

            <div className="divider" />
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>RSVP — Edit or Override</div>
            <div className="form-row">
              <div className="form-group">
                <label>RSVP Status</label>
                <select className="form-select" value={form.rsvpStatus} onChange={set("rsvpStatus")}>
                  <option value="pending">Pending</option>
                  <option value="yes">Attending</option>
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
            {hasPlus && form.plusOneRsvpStatus === "yes" && (
              <div className="form-group">
                <label>Plus One Name</label>
                <input className="form-input" value={form.plusOneRsvpName} onChange={set("plusOneRsvpName")} placeholder="Name of plus one" />
              </div>
            )}
            {form.rsvpStatus === "yes" && (event.parts || []).length > 1 && (
              <div className="form-group">
                <label>Attending Parts</label>
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                  {event.parts.map((p) => <label key={p.id} className="checkbox-label" style={{ fontSize: "0.875rem" }}><input type="checkbox" checked={form.rsvpParts.includes(p.id)} onChange={() => toggleRsvpPart(p.id)} />{p.name}</label>)}
                </div>
              </div>
            )}

            <div className="form-group" style={{ marginTop: "0.25rem" }}>
              <label>Internal Notes</label>
              <textarea className="form-textarea" value={form.notes} onChange={set("notes")} placeholder="Any relevant notes..." style={{ minHeight: 70 }} />
            </div>

            <div className="divider" />
            <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Dietary & Accessibility</div>
            <div className="form-group">
              <label>Guest Dietary Restrictions</label>
              <input className="form-input" value={form.dietary} onChange={set("dietary")} placeholder="e.g. Vegetarian, Nut allergy, Kosher" />
            </div>
            {hasPlus && (
              <div className="form-group">
                <label>Plus One Dietary Restrictions</label>
                <input className="form-input" value={form.plusOneDietary} onChange={set("plusOneDietary")} placeholder="Plus one's dietary needs" />
              </div>
            )}
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

function SortTh({ field, label, sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <th onClick={() => onSort(field)} style={{ cursor: "pointer", userSelect: "none" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        {label}
        <span style={{ fontSize: "0.6rem", color: active ? "var(--navy)" : "var(--gray-300)" }}>{active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
      </span>
    </th>
  );
}

export default function GuestManager() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [csvRawText, setCsvRawText] = useState(null);
  const [search, setSearch] = useState("");
  const [filterPart, setFilterPart] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [quickTagMode, setQuickTagMode] = useState(null);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [selected, setSelected] = useState(new Set());
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

  const toggleSort = (field) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  // ─── Tag management ──────────────────────────────────────────────────────
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
    const affected = guests.filter((g) => (g.tags || []).includes(tagId));
    const batch = writeBatch(db);
    affected.forEach((g) => batch.update(doc(db, "guests", g.id), { tags: (g.tags || []).filter((t) => t !== tagId) }));
    await batch.commit();
    if (quickTagMode === tagId) setQuickTagMode(null);
    if (filterTag === tagId) setFilterTag("all");
  };

  const handleQuickTag = async (guest) => {
    if (!quickTagMode) return;
    const newTags = (guest.tags || []).includes(quickTagMode)
      ? (guest.tags || []).filter((t) => t !== quickTagMode)
      : [...(guest.tags || []), quickTagMode];
    await updateDoc(doc(db, "guests", guest.id), { tags: newTags, updatedAt: serverTimestamp() });
  };

  // ─── Multi-select actions ─────────────────────────────────────────────────
  const toggleSelect = (gid) => setSelected((s) => { const n = new Set(s); n.has(gid) ? n.delete(gid) : n.add(gid); return n; });
  const toggleSelectAll = () => {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((g) => g.id)));
  };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} guest(s)? This cannot be undone.`)) return;
    const batch = writeBatch(db);
    selected.forEach((gid) => batch.delete(doc(db, "guests", gid)));
    await batch.commit();
    setSelected(new Set());
  };

  const bulkTag = async (tagId) => {
    const batch = writeBatch(db);
    selected.forEach((gid) => {
      const guest = guests.find((g) => g.id === gid);
      if (!guest) return;
      const currentTags = guest.tags || [];
      const newTags = currentTags.includes(tagId) ? currentTags : [...currentTags, tagId];
      batch.update(doc(db, "guests", gid), { tags: newTags, updatedAt: serverTimestamp() });
    });
    await batch.commit();
    setSelected(new Set());
  };

  const bulkRsvp = async (status) => {
    const batch = writeBatch(db);
    selected.forEach((gid) => batch.update(doc(db, "guests", gid), { rsvpStatus: status, rsvpOverridden: true, updatedAt: serverTimestamp() }));
    await batch.commit();
    setSelected(new Set());
  };

  // ─── Guest CRUD ───────────────────────────────────────────────────────────
  const saveGuest = async (form, guestId) => {
    const limit = parseInt(form.plusOneLimit, 10);
    // Merge dietary edits into rsvpData
    const existingGuest = guestId ? guests.find((g) => g.id === guestId) : null;
    const baseRsvpData = existingGuest?.rsvpData || {};
    const rsvpData = {
      ...baseRsvpData,
      ...(form.dietary !== undefined ? { "Dietary restrictions": form.dietary } : {}),
      ...(form.plusOneDietary !== undefined ? { "Plus one dietary restrictions": form.plusOneDietary } : {}),
    };
    const { dietary, plusOneDietary, ...rest } = form;
    const data = { ...rest, plusOneEligible: limit !== 0, plusOneLimit: limit, plusOneName: form.staffPlusOneNames?.[0] || "", rsvpData, updatedAt: serverTimestamp() };
    if (guestId) {
      await updateDoc(doc(db, "guests", guestId), data);
    } else {
      await addDoc(collection(db, "guests"), { ...data, eventId: id, rsvpToken: uuid(), rsvpStatus: "pending", rsvpParts: [], emailSent: false, emailOpened: false, emailBounced: false, createdAt: serverTimestamp() });
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
    reader.onload = (ev) => {
      setCsvRawText(ev.target.result);
    };
    reader.readAsText(file);
    csvRef.current.value = "";
  };

  const confirmImport = async (rows) => {
    const batch = writeBatch(db);
    rows.forEach((row) => {
      const hasPlus = (row.plusOne || "").toLowerCase() === "yes";
      const ref = doc(collection(db, "guests"));
      batch.set(ref, {
        eventId: id,
        firstName: row.firstName || "",
        lastName: row.lastName || "",
        title: row.title || "",
        email: row.email || "",
        staffPoc: row.staffPoc || "",
        invitedParts: (event?.parts || []).map((p) => p.id),
        plusOneEligible: hasPlus,
        plusOneLimit: hasPlus ? 1 : 0,
        staffPlusOneNames: [""],
        plusOneName: "",
        tags: [],
        notes: row.notes || "",
        rsvpToken: uuid(),
        rsvpStatus: "pending",
        rsvpParts: [],
        rsvpData: {},
        emailSent: false,
        emailOpened: false,
        emailBounced: false,
        createdAt: serverTimestamp(),
      });
    });
    await batch.commit();
    setCsvRawText(null);
    alert(`Imported ${rows.length} guest${rows.length !== 1 ? "s" : ""}.`);
  };

  const eventTags = event?.tags || [];
  const quickTag = quickTagMode ? eventTags.find((t) => t.id === quickTagMode) : null;
  const multiPart = (event?.parts || []).length > 1;

  const filtered = guests.filter((g) => {
    const name = `${g.title} ${g.firstName} ${g.lastName} ${g.email}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchPart = filterPart === "all" || (g.invitedParts || []).includes(filterPart);
    const matchStatus = filterStatus === "all" || g.rsvpStatus === filterStatus || (!g.rsvpStatus && filterStatus === "pending");
    const matchTag = filterTag === "all" || (g.tags || []).includes(filterTag);
    return matchSearch && matchPart && matchStatus && matchTag;
  });

  const sorted = [...filtered].sort((a, b) => {
    let va, vb;
    if (sortField === "name") { va = `${a.lastName} ${a.firstName}`.toLowerCase(); vb = `${b.lastName} ${b.firstName}`.toLowerCase(); }
    else if (sortField === "staffPoc") { va = (a.staffPoc || "zzz").toLowerCase(); vb = (b.staffPoc || "zzz").toLowerCase(); }
    else if (sortField === "rsvpDate") { va = a.rsvpSubmittedAt?.seconds || 0; vb = b.rsvpSubmittedAt?.seconds || 0; }
    else { va = ""; vb = ""; }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
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

      {/* Tag bar */}
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div className="card-body" style={{ padding: "0.875rem 1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-500)", textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 }}>Tags</span>
            {eventTags.map((tag) => (
              <div key={tag.id} style={{ display: "inline-flex", alignItems: "stretch", height: 28 }}>
                <button onClick={() => setQuickTagMode(quickTagMode === tag.id ? null : tag.id)}
                  style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0 0.625rem", borderRadius: "99px 0 0 99px", background: quickTagMode === tag.id ? tag.color : tag.color + "22", color: quickTagMode === tag.id ? "white" : tag.color, border: `1.5px solid ${tag.color}`, borderRight: "none", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", transition: "var(--transition)", lineHeight: 1 }}>
                  {quickTagMode === tag.id ? "✦ " : ""}{tag.name}
                  {quickTagMode === tag.id && <span style={{ fontSize: "0.65rem", fontWeight: 400 }}>({guests.filter((g) => (g.tags || []).includes(tag.id)).length})</span>}
                </button>
                <button onClick={() => deleteTag(tag.id)}
                  style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, borderRadius: "0 99px 99px 0", background: tag.color + "22", color: tag.color, border: `1.5px solid ${tag.color}`, borderLeft: "none", fontSize: "0.65rem", cursor: "pointer", lineHeight: 1 }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#FEE2E2"; e.currentTarget.style.color = "var(--red)"; e.currentTarget.style.borderColor = "var(--red)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = tag.color + "22"; e.currentTarget.style.color = tag.color; e.currentTarget.style.borderColor = tag.color; }}>✕</button>
              </div>
            ))}
            {showNewTagForm
              ? <NewTagForm onAdd={addTag} onCancel={() => setShowNewTagForm(false)} />
              : <button className="btn btn-ghost btn-sm" style={{ border: "1.5px dashed var(--gray-300)", color: "var(--gray-500)" }} onClick={() => setShowNewTagForm(true)}>＋ New Tag</button>}
          </div>
          {quickTag && (
            <div style={{ marginTop: "0.625rem", padding: "0.4375rem 0.75rem", background: quickTag.color + "15", border: `1px solid ${quickTag.color}44`, borderRadius: "var(--radius)", fontSize: "0.8125rem", color: quickTag.color, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>✦ Quick-tag mode: <strong>{quickTag.name}</strong> — click any row to toggle</span>
              <button onClick={() => setQuickTagMode(null)} style={{ background: "none", border: "none", color: quickTag.color, cursor: "pointer", fontWeight: 700 }}>Done</button>
            </div>
          )}
        </div>
      </div>

      {/* Multi-select action bar */}
      {selected.size > 0 && (
        <div style={{ background: "var(--navy-dark)", color: "var(--white)", borderRadius: "var(--radius)", padding: "0.75rem 1.25rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{selected.size} selected</span>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {eventTags.map((tag) => (
              <button key={tag.id} className="btn btn-sm" onClick={() => bulkTag(tag.id)}
                style={{ background: tag.color + "33", color: "white", border: `1px solid ${tag.color}`, fontSize: "0.75rem" }}>
                Tag: {tag.name}
              </button>
            ))}
            <button className="btn btn-sm" onClick={() => bulkRsvp("yes")} style={{ background: "var(--green)", color: "white", border: "none" }}>Mark Attending</button>
            <button className="btn btn-sm" onClick={() => bulkRsvp("no")} style={{ background: "var(--red)", color: "white", border: "none" }}>Mark Declined</button>
            <button className="btn btn-sm btn-danger" onClick={bulkDelete}>Delete Selected</button>
            <button className="btn btn-ghost btn-sm" style={{ color: "rgba(255,255,255,.7)" }} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}

      {/* CSV hint */}
      <div style={{ fontSize: "0.8rem", color: "var(--gray-400)", marginBottom: "1rem", background: "var(--gray-50)", padding: "0.5rem 0.875rem", borderRadius: "var(--radius)", border: "1px solid var(--gray-200)" }}>
        CSV: <code>First Name, Last Name, Title, Email, Staff POC, Plus One (yes/no), Notes</code>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: "0.75rem" }}>
        {/* Status filter pills */}
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginBottom: "0.625rem" }}>
          {[
            { val: "all",     label: "All",       color: null },
            { val: "yes",     label: "Attending", color: "var(--green)" },
            { val: "pending", label: "Pending",   color: "var(--amber)" },
            { val: "no",      label: "Declined",  color: "var(--red)" },
          ].map(({ val, label, color }) => {
            const count = val === "all" ? guests.length
              : val === "yes" ? guests.filter((g) => g.rsvpStatus === "yes").length
              : val === "no" ? guests.filter((g) => g.rsvpStatus === "no").length
              : guests.filter((g) => !g.rsvpStatus || g.rsvpStatus === "pending").length;
            const active = filterStatus === val;
            return (
              <button key={val} onClick={() => setFilterStatus(val)}
                style={{ padding: "0.375rem 0.875rem", borderRadius: 99, fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer", border: "1.5px solid", transition: "var(--transition)", borderColor: active ? (color || "var(--navy)") : "var(--gray-200)", background: active ? (color || "var(--navy)") : "white", color: active ? "white" : "var(--gray-600)" }}>
                {label} <span style={{ fontSize: "0.7rem", opacity: 0.85 }}>({count})</span>
              </button>
            );
          })}
        </div>
        {/* Secondary filters row */}
        <div className="guest-filters">
          <div className="search-input">
            <input className="form-input" placeholder="Search guests..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: "2.125rem" }} />
          </div>
          {multiPart && (
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
          <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)", marginLeft: "auto" }}>{sorted.length} shown</span>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX: "auto" }}>
        {loading ? <div className="loading">Loading...</div> : sorted.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👥</div>
            <h3>{guests.length === 0 ? "No guests yet" : "No guests match filters"}</h3>
            {guests.length === 0 && <button className="btn btn-primary" style={{ marginTop: "1rem" }} onClick={() => setModal("add")}>Add First Guest</button>}
          </div>
        ) : (
          <table className="data-table" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" checked={selected.size === sorted.length && sorted.length > 0} onChange={toggleSelectAll} style={{ accent: "var(--navy)" }} />
                </th>
                <SortTh field="name" label="Name" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th>Email</th>
                {multiPart && <th>Invited To</th>}
                <th>Plus One</th>
                {eventTags.length > 0 && <th>Tags</th>}
                <SortTh field="staffPoc" label="POC" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <SortTh field="rsvpDate" label="RSVP" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((g) => {
                const limit = g.plusOneLimit ?? (g.plusOneEligible ? 1 : 0);
                const hasQuickTag = quickTagMode && (g.tags || []).includes(quickTagMode);
                // Normalize dietary — check all common field names
                const dietary = g.rsvpData
                  ? Object.entries(g.rsvpData).find(([k]) => k.toLowerCase().includes("dietary") && !k.toLowerCase().includes("plus"))?.[1] || ""
                  : "";
                const plusOneDietary = g.rsvpData
                  ? Object.entries(g.rsvpData).find(([k]) => k.toLowerCase().includes("dietary") && k.toLowerCase().includes("plus"))?.[1] || ""
                  : "";
                // Plus-one display
                const plusOneName = g.plusOneRsvpName || g.staffPlusOneNames?.filter(Boolean)[0] || "";
                const plusOneSource = g.plusOneRsvpName ? "rsvp" : "staff";
                const showPlusOneRow = limit !== 0;
                const isSelected = selected.has(g.id);

                return (
                  <React.Fragment key={g.id}>
                    <tr
                      onClick={() => quickTagMode ? handleQuickTag(g) : undefined}
                      style={{ cursor: quickTagMode ? "pointer" : "default", background: isSelected ? "var(--navy-light)" : quickTagMode ? (hasQuickTag ? quickTag?.color + "18" : "transparent") : undefined }}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(g.id)} style={{ accentColor: "var(--navy)" }} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{g.title ? `${g.title} ` : ""}{g.firstName} {g.lastName}</div>
                        {dietary && <div style={{ fontSize: "0.7rem", color: "var(--amber)", marginTop: "0.125rem" }}>🍽 {dietary}</div>}
                        {g.notes && <div style={{ fontSize: "0.7rem", color: "var(--gray-400)", marginTop: "0.0625rem" }}>📝 {g.notes.slice(0, 55)}{g.notes.length > 55 ? "…" : ""}</div>}
                      </td>
                      <td style={{ fontSize: "0.875rem", color: "var(--gray-500)" }}>{g.email}</td>
                      {multiPart && (
                        <td>
                          <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                            {(g.invitedParts || []).map((pid) => { const part = event.parts.find((p) => p.id === pid); return part ? <PartTag key={pid} part={part} guest={g} /> : null; })}
                          </div>
                        </td>
                      )}
                      <td style={{ fontSize: "0.875rem" }}>
                        {limit !== 0 ? <span style={{ color: "var(--gold-dark)", fontWeight: 600, fontSize: "0.8125rem" }}>✓ {limit === -1 ? "Unlimited" : `Up to ${limit}`}</span> : <span style={{ color: "var(--gray-300)" }}>—</span>}
                      </td>
                      {eventTags.length > 0 && (
                        <td>
                          <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                            {(g.tags || []).map((tid) => { const tag = eventTags.find((t) => t.id === tid); return tag ? <span key={tid} style={{ padding: "0.125rem 0.5rem", borderRadius: "99px", background: tag.color + "22", fontSize: "0.7rem", fontWeight: 700, color: tag.color }}>{tag.name}</span> : null; })}
                          </div>
                        </td>
                      )}
                      <td style={{ fontSize: "0.875rem", color: "var(--gray-500)" }}>{g.staffPoc || "—"}</td>
                      <td>
                        <span className={`badge ${RSVP_BADGE[g.rsvpStatus] || "badge-pending"}`}>{RSVP_STATUS_LABELS[g.rsvpStatus] || "Pending"}</span>
                        {g.rsvpSubmittedAt && <div style={{ fontSize: "0.65rem", color: "var(--gray-400)", marginTop: "0.125rem" }}>{(g.rsvpSubmittedAt.toDate ? g.rsvpSubmittedAt.toDate() : new Date(g.rsvpSubmittedAt)).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: "0.375rem" }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setModal(g)}>Edit</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => deleteGuest(g.id)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                    {showPlusOneRow && (
                      <tr key={`${g.id}_plus`} style={{ background: "#FFFBEB", borderLeft: "3px solid var(--gold)" }}>
                        <td />
                        <td style={{ paddingLeft: "2rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ color: "var(--gold-dark)", fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em" }}>＋1</span>
                            {plusOneName
                              ? <span style={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--gray-700)" }}>
                                  {plusOneName}
                                  {plusOneSource === "staff" && g.rsvpStatus !== "yes" && <span style={{ fontSize: "0.65rem", color: "var(--gray-400)", fontStyle: "italic", marginLeft: 4 }}>staff-entered</span>}
                                </span>
                              : <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)", fontStyle: "italic" }}>
                                  {g.plusOneRsvpStatus === "no" ? "Not bringing a guest" : "Name not provided"}
                                </span>}
                          </div>
                          {plusOneDietary && <div style={{ fontSize: "0.7rem", color: "var(--amber)", marginTop: "0.125rem", paddingLeft: "1.5rem" }}>🍽 {plusOneDietary}</div>}
                        </td>
                        <td style={{ fontSize: "0.8rem", color: "var(--gray-400)" }} colSpan={multiPart ? 2 : 1}>of {g.firstName} {g.lastName}</td>
                        <td colSpan={eventTags.length > 0 ? 2 : 1} />
                        <td>
                          <span className={`badge ${g.plusOneRsvpStatus === "yes" ? "badge-yes" : g.plusOneRsvpStatus === "no" ? "badge-no" : "badge-pending"}`} style={{ fontSize: "0.7rem" }}>
                            {g.plusOneRsvpStatus === "yes" ? "Attending" : g.plusOneRsvpStatus === "no" ? "Declined" : "Pending"}
                          </span>
                        </td>
                        <td />
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modal && <GuestModal event={event} guest={modal === "add" ? null : modal} onClose={() => setModal(null)} onSave={saveGuest} />}
      {csvRawText && <CSVMapperModal csvText={csvRawText} onConfirm={confirmImport} onCancel={() => { setCsvRawText(null); }} />}
    </div>
  );
}
