import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

function fmt24(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hr = parseInt(h, 10);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
}

export default function RSVPPage() {
  const { token } = useParams();
  const [state, setState] = useState("loading");
  const [event, setEvent] = useState(null);
  const [guest, setGuestData] = useState(null);
  const [guestRef, setGuestRef] = useState(null);

  const [partAttendance, setPartAttendance] = useState({});
  const [plusOneAttending, setPlusOneAttending] = useState("");
  const [plusOneName, setPlusOneName] = useState("");
  const [customFields, setCustomFields] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const q = query(collection(db, "guests"), where("rsvpToken", "==", token));
        const snap = await getDocs(q);
        if (snap.empty) { setState("notfound"); return; }
        const guestDoc = snap.docs[0];
        const g = { id: guestDoc.id, ...guestDoc.data() };
        setGuestData(g);
        setGuestRef(guestDoc.ref);
        if (g.rsvpStatus && g.rsvpStatus !== "pending") { setState("submitted"); }
        const evSnap = await getDoc(doc(db, "events", g.eventId));
        if (!evSnap.exists()) { setState("error"); return; }
        const ev = { id: evSnap.id, ...evSnap.data() };
        setEvent(ev);
        const initParts = {};
        (g.invitedParts || []).forEach((pid) => { initParts[pid] = ""; });
        setPartAttendance(initParts);
        setState("form");
      } catch (err) { console.error(err); setState("error"); }
    })();
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    const attendingParts = Object.entries(partAttendance).filter(([, v]) => v === "yes").map(([k]) => k);
    const anyYes = attendingParts.length > 0;
    const allParts = (guest.invitedParts || []).length;
    const rsvpStatus = !anyYes ? "no" : attendingParts.length === allParts ? "yes" : "partial";
    const limit = guest.plusOneLimit ?? (guest.plusOneEligible ? 1 : 0);

    await updateDoc(guestRef, {
      rsvpStatus,
      rsvpParts: attendingParts,
      rsvpData: customFields,
      plusOneRsvpStatus: limit !== 0 && anyYes ? (plusOneAttending || "pending") : "no",
      plusOneRsvpName: plusOneAttending === "yes" ? plusOneName : "",
      rsvpSubmittedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    setState("submitted");
  };

  const setCustom = (label, val) => setCustomFields((s) => ({ ...s, [label]: val }));

  const logoPath = "../cspc-logo.png";

  if (state === "loading") return (
    <div className="rsvp-page">
      <div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
      <div className="rsvp-body"><div className="loading">Loading your invitation...</div></div>
    </div>
  );

  if (state === "notfound") return (
    <div className="rsvp-page">
      <div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
      <div className="rsvp-body">
        <div className="rsvp-event-banner">
          <h1>Invitation not found</h1>
          <p style={{ color: "var(--gray-500)", marginTop: "0.5rem" }}>This RSVP link may be invalid or expired. Please contact <a href="mailto:events@thepresidency.org">events@thepresidency.org</a>.</p>
        </div>
      </div>
    </div>
  );

  if (state === "error") return (
    <div className="rsvp-page">
      <div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
      <div className="rsvp-body"><div className="error-msg">Something went wrong. Please try again or contact us.</div></div>
    </div>
  );

  if (state === "submitted") {
    const attending = guest?.rsvpStatus === "yes" || guest?.rsvpStatus === "partial";
    const dateStr = event?.date
      ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
      : "";
    return (
      <div className="rsvp-page">
        <div className="rsvp-header"><img src={logoPath} alt="CSPC" /></div>
        <div className="rsvp-body">
          <div className="rsvp-thanks">
            <div className="check">{attending ? "✅" : "📋"}</div>
            <h2>{attending ? "We'll see you there!" : "Thank you for letting us know."}</h2>
            <p style={{ color: "var(--gray-500)", fontSize: "0.9375rem" }}>
              {attending
                ? `Your RSVP for ${event?.name} has been received.${dateStr ? ` We look forward to seeing you on ${dateStr}.` : ""}`
                : `We're sorry you won't be able to join us${event?.name ? ` for ${event.name}` : ""}. We hope to see you at a future event.`}
            </p>
            <p style={{ marginTop: "1.25rem", color: "var(--gray-400)", fontSize: "0.8125rem" }}>
              Need to change your response? Contact <a href="mailto:events@thepresidency.org">events@thepresidency.org</a>
            </p>
          </div>
        </div>
        <div className="rsvp-footer">
          <img src={logoPath} alt="CSPC" style={{ height: 26, opacity: 0.35, display: "block", margin: "0 auto 0.5rem" }} />
          <div>Center for the Study of the Presidency and Congress · Washington, D.C.</div>
        </div>
      </div>
    );
  }

  if (!event || !guest) return null;

  const dateStr = event.date
    ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : null;

  const invitedParts = (event.parts || []).filter((p) => (guest.invitedParts || []).includes(p.id));
  const isSinglePart = invitedParts.length === 1;
  const anyAttending = Object.values(partAttendance).some((v) => v === "yes");
  const limit = guest.plusOneLimit ?? (guest.plusOneEligible ? 1 : 0);

  const relevantFields = (event.customFields || []).filter((f) => {
    if (!f.forParts || f.forParts.length === 0) return true;
    return f.forParts.some((pid) => (guest.invitedParts || []).includes(pid));
  });

  return (
    <div className="rsvp-page">
      <div className="rsvp-header">
        <img src={logoPath} alt="Center for the Study of the Presidency and Congress" />
      </div>

      <div className="rsvp-body">
        <div className="rsvp-event-banner">
          <h1>{event.name}</h1>
          <div className="rsvp-event-meta">
            {dateStr && <span>📅 {dateStr}</span>}
            {event.location && <span>📍 {event.location}</span>}
            {invitedParts.map((p) => (
              <span key={p.id}>
                {p.name}{p.startTime ? `: ${fmt24(p.startTime)}${p.endTime ? ` – ${fmt24(p.endTime)}` : ""}` : ""}
              </span>
            ))}
          </div>
        </div>

        <div className="rsvp-form-card">
          <h2>Dear {guest.title ? `${guest.title} ` : ""}{guest.firstName} {guest.lastName},</h2>
          <p style={{ fontSize: "0.9375rem", color: "var(--gray-500)", marginBottom: "1.375rem" }}>
            Please confirm your attendance{invitedParts.length > 1 ? " for each part of the event" : ""} below.
          </p>

          <form onSubmit={submit}>
            {/* Attendance per part */}
            {isSinglePart ? (
              <div className="rsvp-part-block">
                <h3>Will you attend?</h3>
                <div className="rsvp-radio-group">
                  {["yes", "no"].map((opt) => (
                    <label key={opt} className="rsvp-radio">
                      <input type="radio" name={`part_${invitedParts[0].id}`} value={opt} required
                        checked={partAttendance[invitedParts[0].id] === opt}
                        onChange={() => setPartAttendance({ [invitedParts[0].id]: opt })} />
                      {opt === "yes" ? "Yes, I will attend" : "No, I cannot attend"}
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              invitedParts.map((part) => (
                <div key={part.id} className="rsvp-part-block">
                  <h3>
                    {part.name}
                    {part.startTime && <span style={{ fontWeight: 400, fontSize: "0.875rem", marginLeft: "0.5rem" }}>{fmt24(part.startTime)}{part.endTime ? ` – ${fmt24(part.endTime)}` : ""}</span>}
                  </h3>
                  <div className="rsvp-radio-group">
                    {["yes", "no"].map((opt) => (
                      <label key={opt} className="rsvp-radio">
                        <input type="radio" name={`part_${part.id}`} value={opt} required
                          checked={partAttendance[part.id] === opt}
                          onChange={() => setPartAttendance((s) => ({ ...s, [part.id]: opt }))} />
                        {opt === "yes" ? "Yes" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}

            {/* Plus one — guest enters name */}
            {limit !== 0 && anyAttending && (
              <div style={{ marginBottom: "1rem" }}>
                <div className="rsvp-part-block" style={{ background: "var(--gold-light)", borderColor: "rgba(201,168,76,.3)" }}>
                  <h3 style={{ color: "var(--gold-dark)" }}>
                    Plus One {limit === -1 ? "" : limit > 1 ? `(up to ${limit})` : ""}
                  </h3>
                  <div className="rsvp-radio-group" style={{ marginBottom: "0.75rem" }}>
                    {["yes", "no"].map((opt) => (
                      <label key={opt} className="rsvp-radio">
                        <input type="radio" name="plus_one" value={opt} required
                          checked={plusOneAttending === opt}
                          onChange={() => setPlusOneAttending(opt)} />
                        {opt === "yes" ? "Yes, I'll bring a guest" : "No, just me"}
                      </label>
                    ))}
                  </div>
                  {plusOneAttending === "yes" && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label style={{ fontSize: "0.8125rem", fontWeight: 700, color: "var(--gray-600)", display: "block", marginBottom: "0.375rem" }}>
                        Guest's full name <span style={{ color: "var(--red)" }}>*</span>
                      </label>
                      <input className="form-input" value={plusOneName}
                        onChange={(e) => setPlusOneName(e.target.value)}
                        placeholder="Full name of your guest" required />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Custom fields */}
            {anyAttending && relevantFields.length > 0 && (
              <div>
                <div className="divider" />
                {relevantFields.map((field) => (
                  <div key={field.id} className="form-group">
                    <label style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--gray-600)", display: "block", marginBottom: "0.375rem" }}>
                      {field.label}{field.required && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}
                    </label>
                    {field.type === "boolean" ? (
                      <div className="rsvp-radio-group">
                        {["Yes", "No"].map((opt) => (
                          <label key={opt} className="rsvp-radio">
                            <input type="radio" name={field.id} value={opt} required={field.required}
                              checked={customFields[field.label] === opt}
                              onChange={() => setCustom(field.label, opt)} />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : field.type === "select" ? (
                      <select className="form-select" required={field.required}
                        value={customFields[field.label] || ""}
                        onChange={(e) => setCustom(field.label, e.target.value)}>
                        <option value="">Select...</option>
                        {(field.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input className="form-input" type="text" required={field.required}
                        value={customFields[field.label] || ""}
                        onChange={(e) => setCustom(field.label, e.target.value)}
                        placeholder={`Your ${field.label.toLowerCase()}`} />
                    )}
                  </div>
                ))}
              </div>
            )}

            <button type="submit" className="btn btn-primary btn-lg" style={{ width: "100%", marginTop: "1.25rem" }}>
              Submit RSVP
            </button>
          </form>
        </div>
      </div>

      <div className="rsvp-footer">
        <img src={logoPath} alt="CSPC" style={{ height: 26, opacity: 0.35, display: "block", margin: "0 auto 0.5rem" }} />
        <div>Center for the Study of the Presidency and Congress · Washington, D.C.</div>
        <div>Questions? <a href="mailto:events@thepresidency.org">events@thepresidency.org</a></div>
      </div>
    </div>
  );
}
