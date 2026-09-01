import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { formatApiErrorDetail } from "../lib/api";
import { Zap, Loader2, Eye, EyeOff } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try { await login(username, password); }
    catch (e2) { setError(formatApiErrorDetail(e2.response?.data?.detail) || e2.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen mv-noise flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 relative overflow-hidden p-12 border-r border-mv-border bg-gradient-to-br from-white via-blue-50/50 to-white">
        
        <div className="absolute inset-0 bg-gradient-to-t from-white/70 via-transparent to-white/50" />
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" fill="white" />
          </div>
          <div>
            <div className="font-display font-extrabold text-2xl tracking-tight">MyVolt</div>
            <div className="text-xs text-mv-dim tracking-widest uppercase">by Attendy</div>
          </div>
        </div>
        <div className="relative">
          <h1 className="font-display text-5xl font-bold leading-tight tracking-tight">
            Manage your work.<br /><span className="text-mv-primary">All in one platform.</span>
          </h1>
          <p className="text-mv-muted mt-6 max-w-md text-lg">
            One simple platform that adapts to the way your business works.
          </p>
        </div>
        <div className="relative text-xs text-mv-dim">© 2026 MyVolt · Attendy</div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm mv-rise">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <Zap className="w-6 h-6 text-white" fill="white" />
            </div>
            <div className="font-display font-extrabold text-2xl">MyVolt</div>
          </div>
          <h2 className="font-display text-2xl font-semibold">Sign in</h2>
          <p className="text-mv-muted text-sm mt-1">Access your MyVolt workspace.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" autoComplete="off">
            <div>
              <label className="mv-label">Phone / Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} type="text" required autoComplete="off" name="new_username_field" readOnly onFocus={(e) => e.target.removeAttribute("readonly")}
                     placeholder="Enter your phone or email"
                     data-testid="login-email"
                     className="mt-1.5 w-full h-11 px-3.5 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors" />
            </div>
            <div>
              <label className="mv-label">Password</label>
              <div className="relative mt-1.5">
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="text" required autoComplete="off" name="new_password_field" style={{ WebkitTextSecurity: showPassword ? "none" : "disc" }}
                       placeholder="Enter your password"
                       data-testid="login-password"
                       className="w-full h-11 pl-3.5 pr-10 rounded-xl bg-mv-surface border border-mv-border outline-none focus:border-mv-primary transition-colors" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-mv-muted hover:text-mv-text transition">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && <div data-testid="login-error" className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={loading} data-testid="login-submit"
                    className="w-full h-11 rounded-xl bg-mv-primary hover:bg-blue-600 text-white font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />} Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
