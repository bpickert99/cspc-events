import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("signin"); // "signin" | "signup" | "reset"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    setLoading(true);
    try {
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, form.email, {
          url: window.location.href,
        });
        setSuccess(`Reset email sent to ${form.email}. Check your inbox and spam folder — the email comes from noreply@cspc-events.firebaseapp.com.`);
        setLoading(false);
        return;
      }
      if (mode === "signup") {
        await signUp(form.email, form.password, form.name);
      } else {
        await signIn(form.email, form.password);
      }
      navigate("/events");
    } catch (err) {
      const msgs = {
        "auth/invalid-credential": "Invalid email or password.",
        "auth/email-already-in-use": "An account with this email already exists.",
        "auth/weak-password": "Password must be at least 6 characters.",
        "auth/invalid-email": "Please enter a valid email address.",
        "auth/user-not-found": "No account found with this email.",
        "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
      };
      setError(msgs[err.code] || `Something went wrong (${err.code || err.message}). Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m) => { setMode(m); setError(""); setSuccess(""); };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="./cspc-logo.png" alt="CSPC" />
        </div>
        <h1>CSPC Events</h1>
        <p>
          {mode === "signin" && "Sign in to manage events"}
          {mode === "signup" && "Create your staff account"}
          {mode === "reset" && "Reset your password"}
        </p>

        {error && <div className="error-msg">{error}</div>}
        {success && <div className="success-msg">{success}</div>}

        <form onSubmit={submit} style={{ textAlign: "left" }}>
          {mode === "signup" && (
            <div className="form-group">
              <label>Full Name <span className="required">*</span></label>
              <input className="form-input" type="text" required value={form.name} onChange={set("name")} placeholder="Your name" />
            </div>
          )}
          <div className="form-group">
            <label>Email Address <span className="required">*</span></label>
            <input className="form-input" type="email" required value={form.email} onChange={set("email")} placeholder="you@thepresidency.org" />
          </div>
          {mode !== "reset" && (
            <div className="form-group">
              <label>Password <span className="required">*</span></label>
              <input className="form-input" type="password" required value={form.password} onChange={set("password")} placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} />
            </div>
          )}

          {mode === "signin" && (
            <div style={{ textAlign: "right", marginBottom: "0.75rem" }}>
              <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: "0.8125rem", color: "var(--gray-500)" }} onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
            </div>
          )}

          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: "100%" }}>
            {loading ? "Please wait..." : mode === "signin" ? "Sign In" : mode === "signup" ? "Create Account" : "Send Reset Email"}
          </button>
        </form>

        <div style={{ marginTop: "1.25rem", fontSize: "0.875rem", color: "var(--gray-600)", display: "flex", justifyContent: "center", gap: "0.25rem", flexWrap: "wrap" }}>
          {mode === "signin" && (
            <>
              <span>No account?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => switchMode("signup")}>Create one</button>
            </>
          )}
          {mode === "signup" && (
            <>
              <span>Already have an account?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => switchMode("signin")}>Sign in</button>
            </>
          )}
          {mode === "reset" && (
            <button className="btn btn-ghost btn-sm" onClick={() => switchMode("signin")}>← Back to sign in</button>
          )}
        </div>
      </div>
    </div>
  );
}
