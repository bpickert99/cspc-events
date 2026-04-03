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

function GuestModal({ event, guest, onClose, onSave }) {
  const isEdit = Boolean(guest);
  const [form, setForm] = useState({
    firstName: guest?.firstName || "",
    lastName: guest?.lastName || "",
    title: guest?.title || "",
    email: guest?.email || "",
    invitedParts: guest?.invitedParts || (event.parts || []).map((p) => p.id),
    plusOneEligible: guest?.plusOneEligible || false,
    staffPoc: guest?.staffPoc || "",
    notes: guest?.notes || "",
    rsvpStatus: guest?.rsvpStatus || "pending",
    rsvpParts: guest?.rsvpParts || [],
    rsvpData: guest?.rsvpData || {},
    plusOneName: guest?.plusOneName || "",
    plusOneEmail: guest?.plusOneEmail || "",
    plusOneRsvpStatus: guest?.plusOneRsvpStatus || "pending",
  });
  const [saving, setSaving] = useState(false);
  const set = (f) => (e) => setForm((s) => ({ ...s, [f]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const togglePart = (pid) => {
    setForm((s) => {
      const inv = s.invitedParts.includes(pid) ? s.invitedParts.filter((x) => x !== pid) : [...s.invitedParts, pid];
      return { ...s, invitedParts: inv };
    });
  };

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
                <label>Email Address <span className="required">*</span></label>
                <input className="form-input" type="email" required value={form.email} onChange={set("email")} />
              </div>
            </div>
            <div className="form-group">
              <label>Staff POC</label>
              <input className="form-input" value={form.staffPoc} onChange={set("staffPoc")} placeholder="Who is managing this guest?" />
            </div>

            {/* Invited parts */}
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

            {/* Plus one */}
            <div className="form-group">
              <label className="checkbox-label">
                <input type="checkbox" checked={form.plusOneEligible} onChange={set("plusOneEligible")} />
                This guest may bring a plus one
              </label>
            </div>
            {form.plusOneEligible && (
              <div style={{ background: "var(--gold-light)", border: "1px solid var(--gold)", borderRadius: "var(--radius)", padding: "0.875rem", marginBottom: "0.875rem" }}>
                <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--gray-600)", marginBottom: "0.5rem" }}>PLUS ONE</div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Plus One Name</label>
                    <input className="form-input" value={form.plusOneName} onChange={set("plusOneName")} placeholder="Name (if known)" />
                  </div>
                  <div className="form-group">
                    <label>Plus One Email</label>
                    <input className="form-input" type="email" value={form.plusOneEmail} onChange={set("plusOneEmail")} placeholder="(if known)" />
                  </div>
                </div>
              </div>
            )}

            {/* RSVP override (for manual updates) */}
            {isEdit && (
              <>
                <div className="divider" />
                <div style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--gray-400)", marginBottom: "0.75rem" }}>RSVP STATUS (MANUAL OVERRIDE)</div>
                <div className="form-row">
                  <div className="form-group">
                    <label>RSVP Status</label>
                    <select className="form-select" value={form.rsvpStatus} onChange={set("rsvpStatus")}>
                      <option value="pending">Pending</option>
                      <option value="yes">Attending</option>
                      <option value="partial">Partial (some parts)</option>
                      <option value="no">Declined</option>
                    </select>
                  </div>
                  {form.plusOneEligible && (
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
                {(form.rsvpStatus === "yes" || form.rsvpStatus === "partial") && event.parts?.length > 1 && (
                  <div className="form-group">
                    <label>Attending Which Parts</label>
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                      {event.parts.map((p) => (
                        <label key={p.id} className="checkbox-label" style={{ fontSize: "0.875rem" }}>
                          <input type="checkbox" checked={form.rsvpParts.includes(p.id)}
                            onChange={() => setForm((s) => ({
                              ...s,
                              rsvpParts: s.rsvpParts.includes(p.id) ? s.rsvpParts.filter((x) => x !== p.id) : [...s.rsvpParts, p.id]
                            }))} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Notes */}
            <div className="form-group" style={{ marginTop: "0.25rem" }}>
              <label>Internal Notes</label>
              <textarea className="form-textarea" value={form.notes} onChange={set("notes")} placeholder="Any relevant notes about this guest..." style={{ minHeight: 70 }} />
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

export default function GuestManager() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | "add" | guest object
  const [search, setSearch] = useState("");
  const [filterPart, setFilterPart] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
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

  const saveGuest = async (form, guestId) => {
    if (guestId) {
      await updateDoc(doc(db, "guests", guestId), { ...form, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "guests"), {
        ...form,
        eventId: id,
        rsvpToken: uuid(),
        rsvpStatus: "pending",
        rsvpParts: [],
        rsvpData: {},
        emailSent: false,
        emailOpened: false,
        emailBounced: false,
        createdAt: serverTimestamp(),
      });
      // Update event guest count
      const q2 = query(collection(db, "guests"), where("eventId", "==", id));
    }
    setModal(null);
  };

  const deleteGuest = async (guestId) => {
    if (!confirm("Remove this guest from the event?")) return;
    await deleteDoc(doc(db, "guests", guestId));
  };

  // CSV import
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
        const ref = doc(collection(db, "guests"));
        batch.set(ref, {
          eventId: id,
          firstName: row.firstname || row["first name"] || "",
          lastName: row.lastname || row["last name"] || "",
          title: row.title || "",
          email: row.email || "",
          staffPoc: row.staffpoc || row.poc || "",
          invitedParts: (event?.parts || []).map((p) => p.id),
          plusOneEligible: (row.plusone || row["plus one"] || "").toLowerCase() === "yes",
          plusOneName: row.plusonename || "",
          plusOneEmail: row.plusoneemail || "",
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
        count++;
      }
      await batch.commit();
      alert(`Imported ${count} guests.`);
    };
    reader.readAsText(file);
    csvRef.current.value = "";
  };

  const filtered = guests.filter((g) => {
    const name = `${g.title} ${g.firstName} ${g.lastName} ${g.email}`.toLowerCase();
    const matchSearch = !search || name.includes(search.toLowerCase());
    const matchPart = filterPart === "all" || (g.invitedParts || []).includes(filterPart);
    const matchStatus = filterStatus === "all" || g.rsvpStatus === filterStatus || (!g.rsvpStatus && filterStatus === "pending");
    return matchSearch && matchPart && matchStatus;
  });

  if (!event) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Guests — {event.name}</h1>
          <p>{guests.length} guests total</p>
        </div>
        <div className="page-actions">
          <input ref={csvRef} type="file" accept=".csv" style={{ display: "none" }} onChange={importCSV} />
          <button className="btn btn-secondary btn-sm" onClick={() => csvRef.current.click()}>⬆ Import CSV</button>
          <button className="btn btn-primary" onClick={() => setModal("add")}>＋ Add Guest</button>
        </div>
      </div>

      {/* CSV hint */}
      <div style={{ fontSize: "0.8rem", color: "var(--gray-400)", marginBottom: "1rem", background: "var(--gray-50)", padding: "0.5rem 0.875rem", borderRadius: "var(--radius)", border: "1px solid var(--gray-200)" }}>
        CSV format: <code>First Name, Last Name, Title, Email, Staff POC, Plus One, Plus One Name, Notes</code>
      </div>

      {/* Filters */}
      <div className="guest-filters">
        <div className="search-input">
          <input className="form-input" placeholder="Search guests..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: "2rem" }} />
        </div>
        {(event.parts || []).length > 1 && (
          <select className="form-select" style={{ width: "auto" }} value={filterPart} onChange={(e) => setFilterPart(e.target.value)}>
            <option value="all">All parts</option>
            {event.parts.map((p) => <option key={p.id} value={p.id}>{p.name} only</option>)}
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

      <div className="card">
        {loading ? (
          <div className="loading">Loading guests...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👥</div>
            <h3>{guests.length === 0 ? "No guests yet" : "No guests match your filters"}</h3>
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
                <th>POC</th>
                <th>RSVP</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => (
                <tr key={g.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{g.title ? `${g.title} ` : ""}{g.firstName} {g.lastName}</div>
                    {g.notes && <div style={{ fontSize: "0.75rem", color: "var(--gray-400)", marginTop: "0.125rem" }}>📝 {g.notes.slice(0, 60)}{g.notes.length > 60 ? "..." : ""}</div>}
                  </td>
                  <td style={{ fontSize: "0.875rem", color: "var(--gray-600)" }}>{g.email}</td>
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
                    {g.plusOneEligible ? (
                      <span style={{ color: "var(--gold)" }}>✓ {g.plusOneName ? `(${g.plusOneName})` : "eligible"}</span>
                    ) : (
                      <span style={{ color: "var(--gray-400)" }}>—</span>
                    )}
                  </td>
                  <td style={{ fontSize: "0.875rem", color: "var(--gray-600)" }}>{g.staffPoc || "—"}</td>
                  <td>
                    <span className={`badge ${RSVP_BADGE[g.rsvpStatus] || "badge-pending"}`}>
                      {RSVP_STATUS_LABELS[g.rsvpStatus] || "Pending"}
                    </span>
                    {g.rsvpStatus === "partial" && event.parts?.length > 1 && (
                      <div style={{ fontSize: "0.7rem", color: "var(--gray-400)", marginTop: "0.25rem" }}>
                        {(g.rsvpParts || []).map((pid) => event.parts.find((p) => p.id === pid)?.name).filter(Boolean).join(", ")}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "0.375rem" }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setModal(g)}>Edit</button>
                      <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => deleteGuest(g.id)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
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
