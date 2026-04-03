import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { collection, doc, addDoc, updateDoc, getDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../contexts/AuthContext";
import { v4 as uuid } from "uuid";

const FIELD_TYPES = [
  { value: "boolean", label: "Yes / No" },
  { value: "text", label: "Short text" },
  { value: "select", label: "Dropdown / choice" },
];

const DEFAULT_PARTS = [
  { id: uuid(), name: "Reception", startTime: "", endTime: "" },
  { id: uuid(), name: "Dinner", startTime: "", endTime: "" },
];

const PRESET_FIELDS = [
  { label: "Dietary restrictions", type: "text" },
  { label: "Plus one attending", type: "boolean" },
  { label: "Plus one name", type: "text" },
  { label: "Plus one dietary restrictions", type: "text" },
  { label: "Accessibility needs", type: "text" },
];

export default function EventCreate() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [hasSeating, setHasSeating] = useState(false);
  const [parts, setParts] = useState(DEFAULT_PARTS);
  const [customFields, setCustomFields] = useState([]);

  useEffect(() => {
    if (!isEdit) return;
    getDoc(doc(db, "events", id)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setName(d.name || "");
      setLocation(d.location || "");
      setDescription(d.description || "");
      setHasSeating(d.hasSeating || false);
      setParts(d.parts || DEFAULT_PARTS);
      setCustomFields(d.customFields || []);
      if (d.date) {
        const dt = d.date.toDate ? d.date.toDate() : new Date(d.date);
        setDateStr(dt.toISOString().slice(0, 10));
      }
    });
  }, [id, isEdit]);

  // ─── Parts ─────────────────────────────────────────────────────────────────
  const addPart = () => setParts((p) => [...p, { id: uuid(), name: "", startTime: "", endTime: "" }]);
  const removePart = (pid) => setParts((p) => p.filter((x) => x.id !== pid));
  const updatePart = (pid, field, val) =>
    setParts((p) => p.map((x) => (x.id === pid ? { ...x, [field]: val } : x)));

  // ─── Custom fields ─────────────────────────────────────────────────────────
  const addField = (preset = null) => {
    const base = preset
      ? { id: uuid(), label: preset.label, type: preset.type, options: [], forParts: parts.map((p) => p.id), required: false }
      : { id: uuid(), label: "", type: "text", options: [], forParts: parts.map((p) => p.id), required: false };
    setCustomFields((f) => [...f, base]);
  };
  const removeField = (fid) => setCustomFields((f) => f.filter((x) => x.id !== fid));
  const updateField = (fid, field, val) =>
    setCustomFields((f) => f.map((x) => (x.id === fid ? { ...x, [field]: val } : x)));
  const toggleFieldPart = (fid, pid) =>
    setCustomFields((f) =>
      f.map((x) => {
        if (x.id !== fid) return x;
        const forParts = x.forParts.includes(pid) ? x.forParts.filter((p) => p !== pid) : [...x.forParts, pid];
        return { ...x, forParts };
      })
    );

  // ─── Save ─────────────────────────────────────────────────────────────────
  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Event name is required.");
    if (parts.some((p) => !p.name.trim())) return setError("All event parts must have a name.");
    setSaving(true);
    setError("");
    try {
      const dateObj = dateStr ? Timestamp.fromDate(new Date(dateStr)) : null;
      const payload = {
        name: name.trim(),
        date: dateObj,
        location: location.trim(),
        description: description.trim(),
        hasSeating,
        parts,
        customFields,
        updatedAt: serverTimestamp(),
      };
      if (isEdit) {
        await updateDoc(doc(db, "events", id), payload);
        navigate(`/events/${id}`);
      } else {
        payload.createdBy = user.uid;
        payload.createdAt = serverTimestamp();
        payload.coHosts = [];
        payload.guestCount = 0;
        const ref = await addDoc(collection(db, "events"), payload);
        navigate(`/events/${ref.id}/guests`);
      }
    } catch (err) {
      setError("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{isEdit ? "Edit Event" : "Create New Event"}</h1>
          <p>{isEdit ? "Update event details, parts, and RSVP fields." : "Set up your event details, then add guests."}</p>
        </div>
      </div>

      <form onSubmit={save}>
        {error && <div className="error-msg">{error}</div>}

        {/* Basic details */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header"><h2>Event Details</h2></div>
          <div className="card-body">
            <div className="form-group">
              <label>Event Name <span className="required">*</span></label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pre-Alfalfa Reception & Dinner" required />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Date</label>
                <input className="form-input" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Location / Venue</label>
                <input className="form-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. The Hay-Adams Hotel" />
              </div>
            </div>
            <div className="form-group">
              <label>Description / Notes</label>
              <textarea className="form-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Any internal notes about the event..." />
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={hasSeating} onChange={(e) => setHasSeating(e.target.checked)} />
              This event has assigned seating (enables seating manager)
            </label>
          </div>
        </div>

        {/* Event parts */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header">
            <h2>Event Parts</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={addPart}>＋ Add Part</button>
          </div>
          <div className="card-body">
            <p style={{ fontSize: "0.875rem", color: "var(--gray-400)", marginBottom: "1rem" }}>
              Define the different parts of your event (e.g. Reception, Dinner). Guests can be invited to specific parts, or all of them.
            </p>
            {parts.map((part, i) => (
              <div key={part.id} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginBottom: "0.75rem", background: "var(--gray-50)", padding: "0.875rem", borderRadius: "var(--radius)" }}>
                <div style={{ flex: "2" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", display: "block", marginBottom: "0.25rem" }}>PART NAME</label>
                  <input className="form-input" value={part.name} onChange={(e) => updatePart(part.id, "name", e.target.value)} placeholder={`Part ${i + 1} name`} />
                </div>
                <div style={{ flex: "1" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", display: "block", marginBottom: "0.25rem" }}>START TIME</label>
                  <input className="form-input" type="time" value={part.startTime} onChange={(e) => updatePart(part.id, "startTime", e.target.value)} />
                </div>
                <div style={{ flex: "1" }}>
                  <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", display: "block", marginBottom: "0.25rem" }}>END TIME</label>
                  <input className="form-input" type="time" value={part.endTime} onChange={(e) => updatePart(part.id, "endTime", e.target.value)} />
                </div>
                {parts.length > 1 && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "1.25rem" }} onClick={() => removePart(part.id)}>✕</button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Custom RSVP fields */}
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <div className="card-header">
            <h2>RSVP Form Fields</h2>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addField()}>＋ Custom Field</button>
          </div>
          <div className="card-body">
            <p style={{ fontSize: "0.875rem", color: "var(--gray-400)", marginBottom: "1rem" }}>
              Add questions to your RSVP form. Each field can be shown for specific parts of the event. Attendance confirmation is always collected.
            </p>

            {/* Quick-add presets */}
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--gray-600)", marginBottom: "0.5rem" }}>Quick-add common fields:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                {PRESET_FIELDS.map((p) => (
                  <button type="button" key={p.label} className="btn btn-ghost btn-sm" style={{ border: "1px dashed var(--gray-300)" }} onClick={() => addField(p)}>
                    ＋ {p.label}
                  </button>
                ))}
              </div>
            </div>

            {customFields.length === 0 ? (
              <div style={{ color: "var(--gray-400)", fontSize: "0.875rem" }}>No custom fields added yet.</div>
            ) : (
              customFields.map((field) => (
                <div key={field.id} style={{ background: "var(--gray-50)", borderRadius: "var(--radius)", padding: "0.875rem", marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", marginBottom: "0.625rem" }}>
                    <div style={{ flex: "3" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", display: "block", marginBottom: "0.25rem" }}>FIELD LABEL</label>
                      <input className="form-input" value={field.label} onChange={(e) => updateField(field.id, "label", e.target.value)} placeholder="e.g. Dietary restrictions" />
                    </div>
                    <div style={{ flex: "2" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", display: "block", marginBottom: "0.25rem" }}>TYPE</label>
                      <select className="form-select" value={field.type} onChange={(e) => updateField(field.id, "type", e.target.value)}>
                        {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "1.25rem" }} onClick={() => removeField(field.id)}>✕</button>
                  </div>

                  {field.type === "select" && (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", display: "block", marginBottom: "0.25rem" }}>OPTIONS (comma-separated)</label>
                      <input className="form-input" value={(field.options || []).join(", ")} onChange={(e) => updateField(field.id, "options", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="Option 1, Option 2, Option 3" />
                    </div>
                  )}

                  {parts.length > 1 && (
                    <div>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--gray-400)", marginBottom: "0.375rem" }}>SHOW FOR PARTS:</div>
                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                        {parts.map((p) => (
                          <label key={p.id} className="checkbox-label" style={{ fontSize: "0.8125rem" }}>
                            <input type="checkbox" checked={(field.forParts || []).includes(p.id)} onChange={() => toggleFieldPart(field.id, p.id)} />
                            {p.name || `Part ${parts.indexOf(p) + 1}`}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="checkbox-label" style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
                    <input type="checkbox" checked={field.required || false} onChange={(e) => updateField(field.id, "required", e.target.checked)} />
                    Required
                  </label>
                </div>
              ))
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Event & Add Guests →"}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => navigate(isEdit ? `/events/${id}` : "/events")}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
