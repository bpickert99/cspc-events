import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
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
      };
      setError(msgs[err.code] || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <img src="./cspc-logo.png" alt="CSPC" style={{ height: 52, display: "block", margin: "0 auto" }} />
        </div>
        <h1>CSPC Events</h1>
        <p>{mode === "signin" ? "Sign in to manage events" : "Create your staff account"}</p>

        {error && <div className="error-msg">{error}</div>}

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
          <div className="form-group">
            <label>Password <span className="required">*</span></label>
            <input className="form-input" type="password" required value={form.password} onChange={set("password")} placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} />
          </div>
          <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: "100%", marginTop: "0.5rem" }}>
            {loading ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div style={{ marginTop: "1.25rem", fontSize: "0.875rem", color: "var(--gray-600)" }}>
          {mode === "signin" ? (
            <>No account yet?{" "}<button className="btn btn-ghost btn-sm" onClick={() => setMode("signup")}>Create one</button></>
          ) : (
            <>Already have an account?{" "}<button className="btn btn-ghost btn-sm" onClick={() => setMode("signin")}>Sign in</button></>
          )}
        </div>

        <div style={{ marginTop: "1.5rem", padding: "0.75rem", background: "var(--gray-50)", borderRadius: "var(--radius)", fontSize: "0.8rem", color: "var(--gray-400)", textAlign: "left" }}>
          <strong>Test mode:</strong> Using email/password authentication. Microsoft sign-in will be added once Azure AD is configured.
        </div>
      </div>
    </div>
  );
}
