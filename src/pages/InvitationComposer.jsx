import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc, getDocs, query, collection, where, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage, TEST_MODE } from "../firebase";

const MERGE_FIELDS = [
  { token: "{{firstName}}", label: "First Name" },
  { token: "{{lastName}}", label: "Last Name" },
  { token: "{{fullName}}", label: "Full Name (with title)" },
  { token: "{{eventName}}", label: "Event Name" },
  { token: "{{eventDate}}", label: "Event Date" },
  { token: "{{eventLocation}}", label: "Venue" },
  { token: "{{rsvpLink}}", label: "RSVP Link" },
];

function resolveMerge(text, guest, event, baseUrl) {
  const dateStr = event.date
    ? (event.date.toDate ? event.date.toDate() : new Date(event.date)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : "TBD";
  return text
    .replace(/{{firstName}}/g, guest.firstName)
    .replace(/{{lastName}}/g, guest.lastName)
    .replace(/{{fullName}}/g, `${guest.title ? guest.title + " " : ""}${guest.firstName} ${guest.lastName}`.trim())
    .replace(/{{eventName}}/g, event.name)
    .replace(/{{eventDate}}/g, dateStr)
    .replace(/{{eventLocation}}/g, event.location || "")
    .replace(/{{rsvpLink}}/g, `${baseUrl}#/rsvp/${guest.rsvpToken}`);
}

function buildEmailHtml(subject, bodyText, guest, event, attachments, logoUrl, baseUrl) {
  const resolved = resolveMerge(bodyText, guest, event, baseUrl);
  const rsvpLink = `${baseUrl}#/rsvp/${guest.rsvpToken}`;
  const attHtml = attachments.length
    ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #E5E7EB;font-size:13px;color:#6B7280;">
        <strong>Attachments:</strong> ${attachments.map((a) => `<a href="${a.url}" style="color:#1B2B6B;">${a.name}</a>`).join(" &nbsp;|&nbsp; ")}
       </div>`
    : "";
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F4F6FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F4F6FB;padding:32px 16px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12);">
  <tr><td style="background:#0F1A45;padding:28px 32px;text-align:center;">
    <img src="${logoUrl}" alt="CSPC" style="height:48px;filter:brightness(0) invert(1);" />
  </td></tr>
  <tr><td style="padding:32px 36px;color:#1F2937;font-size:15px;line-height:1.7;">
    <div style="white-space:pre-wrap;">${resolved}</div>
    <div style="margin-top:28px;text-align:center;">
      <a href="${rsvpLink}" style="display:inline-block;background:#1B2B6B;color:#FFFFFF;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;">RSVP Now</a>
    </div>
    ${attHtml}
  </td></tr>
  <tr><td style="background:#F7F8FC;padding:18px 36px;text-align:center;font-size:12px;color:#9CA3AF;border-top:1px solid #E5E7EB;">
    Center for the Study of the Presidency and Congress &nbsp;·&nbsp; Washington, D.C.<br>
    1020 19th Street NW, Suite 250, Washington, DC 20036
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function sendEmailViaGraph(accessToken, senderEmail, toEmail, subject, htmlBody, attachments) {
  const msgAttachments = await Promise.all(
    attachments.map(async (a) => {
      const resp = await fetch(a.url);
      const buf = await resp.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentBytes: b64 };
    })
  );
  const body = {
    message: {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: [{ emailAddress: { address: toEmail } }],
      attachments: msgAttachments,
    },
  };
  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  if (!resp.ok) throw new Error(`Graph API error: ${resp.status}`);
}

export default function InvitationComposer() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [guests, setGuests] = useState([]);
  const [template, setTemplate] = useState({ subject: "", body: "", attachments: [] });
  const [previewGuest, setPreviewGuest] = useState(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [selectedGuests, setSelectedGuests] = useState("unsent"); // "unsent" | "all" | "custom"
  const [customIds, setCustomIds] = useState(new Set());
  const [tab, setTab] = useState("compose"); // "compose" | "recipients"

  const baseUrl = window.location.origin + window.location.pathname.replace(/index\.html$/, "");

  useEffect(() => {
    getDoc(doc(db, "events", id)).then((s) => {
      if (s.exists()) {
        const ev = { id: s.id, ...s.data() };
        setEvent(ev);
        setTemplate((t) => ({
          ...t,
          subject: t.subject || `You're invited: ${ev.name}`,
          body: t.body || `Dear {{fullName}},\n\nWe are pleased to invite you to ${ev.name}${ev.date ? " on {{eventDate}}" : ""}${ev.location ? " at {{eventLocation}}" : ""}.\n\nPlease RSVP using the link below.\n\nWarm regards,\nThe CSPC Team`,
        }));
      }
    });
    getDoc(doc(db, "emailTemplates", id)).then((s) => {
      if (s.exists()) setTemplate(s.data());
    });
    getDocs(query(collection(db, "guests"), where("eventId", "==", id))).then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setGuests(list);
      if (list.length > 0) setPreviewGuest(list[0]);
    });
  }, [id]);

  const saveTemplate = async () => {
    await setDoc(doc(db, "emailTemplates", id), { ...template, updatedAt: serverTimestamp() });
  };

  const uploadAttachment = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const storageRef = ref(storage, `attachments/${id}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      setTemplate((t) => ({ ...t, attachments: [...(t.attachments || []), { name: file.name, url, size: file.size }] }));
    } finally {
      setUploadingFile(false);
      e.target.value = "";
    }
  };

  const removeAttachment = (name) =>
    setTemplate((t) => ({ ...t, attachments: t.attachments.filter((a) => a.name !== name) }));

  const getTargetGuests = () => {
    if (selectedGuests === "unsent") return guests.filter((g) => !g.emailSent);
    if (selectedGuests === "all") return guests;
    return guests.filter((g) => customIds.has(g.id));
  };

  const sendAll = async () => {
    const targets = getTargetGuests();
    if (!targets.length) return alert("No guests to send to.");
    if (!confirm(`Send invitations to ${targets.length} guest(s)?`)) return;
    setSending(true);
    setSendResult(null);
    await saveTemplate();

    const logoUrl = `${baseUrl}cspc-logo.png`;
    let sent = 0, failed = 0;

    for (const guest of targets) {
      try {
        const html = buildEmailHtml(template.subject, template.body, guest, event, template.attachments || [], logoUrl, baseUrl);
        const subject = resolveMerge(template.subject, guest, event, baseUrl);

        if (TEST_MODE) {
          console.log(`[TEST MODE] Email to: ${guest.email}\nSubject: ${subject}\n---`);
          await new Promise((r) => setTimeout(r, 100)); // small delay to simulate
        } else {
          // TODO: Obtain Graph API access token via MSAL before calling this
          // await sendEmailViaGraph(accessToken, GRAPH_CONFIG.senderEmail, guest.email, subject, html, template.attachments || []);
          throw new Error("Graph API not yet configured. Set TEST_MODE = false and wire up MSAL token.");
        }
        await updateDoc(doc(db, "guests", guest.id), { emailSent: true, emailSentAt: serverTimestamp() });
        sent++;
      } catch (err) {
        console.error("Failed to send to", guest.email, err);
        failed++;
      }
    }
    setSendResult({ sent, failed });
    setSending(false);
  };

  if (!event) return <div className="loading">Loading...</div>;
  const targets = getTargetGuests();

  const previewHtml = previewGuest
    ? buildEmailHtml(template.subject, template.body, previewGuest, event, template.attachments || [], "./cspc-logo.png", baseUrl)
    : "";

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Invitations — {event.name}</h1>
          <p>Compose your email, then send to your guest list.</p>
        </div>
      </div>

      {TEST_MODE && (
        <div className="success-msg" style={{ background: "var(--gold-light)", borderColor: "var(--gold)", color: "#92400E" }}>
          <strong>Test Mode:</strong> Emails will be logged to the browser console instead of sent. Toggle <code>TEST_MODE</code> in <code>firebase.js</code> once Graph API is configured.
        </div>
      )}

      {sendResult && (
        <div className={sendResult.failed === 0 ? "success-msg" : "error-msg"}>
          {sendResult.sent} email(s) sent{sendResult.failed > 0 ? `, ${sendResult.failed} failed (check console)` : ""}.
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === "compose" ? "active" : ""}`} onClick={() => setTab("compose")}>Compose</button>
        <button className={`tab ${tab === "recipients" ? "active" : ""}`} onClick={() => setTab("recipients")}>Recipients</button>
      </div>

      {tab === "compose" && (
        <div className="compose-layout">
          {/* Left: editor */}
          <div>
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header"><h2>Email Content</h2></div>
              <div className="card-body">
                <div className="form-group">
                  <label>Subject Line</label>
                  <input className="form-input" value={template.subject} onChange={(e) => setTemplate((t) => ({ ...t, subject: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Body Text</label>
                  <div className="merge-field-list">
                    {MERGE_FIELDS.map((m) => (
                      <button key={m.token} type="button" className="btn btn-ghost btn-sm" style={{ fontSize: "0.7rem", padding: "0.1875rem 0.5rem", border: "1px solid var(--gray-200)" }}
                        onClick={() => setTemplate((t) => ({ ...t, body: t.body + m.token }))}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <textarea className="form-textarea" style={{ minHeight: 220, marginTop: "0.5rem", fontFamily: "monospace", fontSize: "0.875rem" }}
                    value={template.body} onChange={(e) => setTemplate((t) => ({ ...t, body: e.target.value }))} />
                  <div className="form-hint">Use the buttons above to insert personalized fields into your email.</div>
                </div>
              </div>
            </div>

            {/* Attachments */}
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div className="card-header"><h2>Attachments</h2></div>
              <div className="card-body">
                <input type="file" id="attach-upload" style={{ display: "none" }} onChange={uploadAttachment} />
                <button className="btn btn-secondary btn-sm" onClick={() => document.getElementById("attach-upload").click()} disabled={uploadingFile}>
                  {uploadingFile ? "Uploading..." : "＋ Add Attachment"}
                </button>
                {(template.attachments || []).length > 0 && (
                  <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    {template.attachments.map((a) => (
                      <div key={a.name} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
                        <span>📎 {a.name}</span>
                        <span style={{ color: "var(--gray-400)", fontSize: "0.75rem" }}>({Math.round(a.size / 1024)} KB)</span>
                        <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)", padding: "0.125rem 0.375rem" }} onClick={() => removeAttachment(a.name)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Preview selector */}
            <div className="card">
              <div className="card-header"><h2>Preview As</h2></div>
              <div className="card-body">
                <select className="form-select" value={previewGuest?.id || ""} onChange={(e) => setPreviewGuest(guests.find((g) => g.id === e.target.value))}>
                  {guests.map((g) => <option key={g.id} value={g.id}>{g.firstName} {g.lastName}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Right: live preview */}
          <div>
            <div className="card" style={{ position: "sticky", top: "72px" }}>
              <div className="card-header"><h2>Email Preview</h2></div>
              <div className="card-body" style={{ padding: 0, overflow: "hidden", borderRadius: "0 0 6px 6px" }}>
                {previewGuest ? (
                  <iframe srcDoc={previewHtml} title="Email Preview" style={{ width: "100%", height: 500, border: "none" }} />
                ) : (
                  <div className="empty-state" style={{ padding: "2rem" }}>Add guests to preview</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "recipients" && (
        <div>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <div className="card-header"><h2>Who to Send To</h2></div>
            <div className="card-body">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                {[
                  { val: "unsent", label: `All guests who haven't been sent an email yet (${guests.filter((g) => !g.emailSent).length} guests)` },
                  { val: "all", label: `All guests — resend to everyone (${guests.length} guests)` },
                  { val: "custom", label: "Select specific guests" },
                ].map((opt) => (
                  <label key={opt.val} className="checkbox-label">
                    <input type="radio" name="sendTo" value={opt.val} checked={selectedGuests === opt.val} onChange={() => setSelectedGuests(opt.val)} />
                    {opt.label}
                  </label>
                ))}
              </div>

              {selectedGuests === "custom" && (
                <div style={{ marginTop: "1rem" }}>
                  <table className="data-table">
                    <thead><tr><th>Select</th><th>Name</th><th>Email</th><th>Status</th></tr></thead>
                    <tbody>
                      {guests.map((g) => (
                        <tr key={g.id}>
                          <td><input type="checkbox" checked={customIds.has(g.id)} onChange={() => setCustomIds((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })} /></td>
                          <td>{g.firstName} {g.lastName}</td>
                          <td style={{ fontSize: "0.875rem", color: "var(--gray-600)" }}>{g.email}</td>
                          <td><span className={`badge ${g.emailSent ? "badge-sent" : "badge-pending"}`}>{g.emailSent ? "Sent" : "Not sent"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <button className="btn btn-primary btn-lg" onClick={sendAll} disabled={sending || targets.length === 0}>
              {sending ? "Sending..." : `Send to ${targets.length} Guest${targets.length !== 1 ? "s" : ""}`}
            </button>
            <button className="btn btn-ghost" onClick={saveTemplate}>Save Draft</button>
            <span style={{ fontSize: "0.8125rem", color: "var(--gray-400)" }}>
              {TEST_MODE ? "Test mode: emails logged to console" : "Sending from events@thepresidency.org"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
