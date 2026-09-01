import { useEffect, useState } from "react";
import { Plus, Users, KeyRound, Shield, Eye, EyeOff, Trash, Pencil } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useAuth, roleLabel } from "../context/AuthContext";
import { CITIES, useApp } from "../context/AppContext";
import { Skeleton, StatusChip } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, Field, TextInput, GhostBtn } from "../components/common/Page";
import { inr } from "../lib/format";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Avatar, AvatarFallback } from "../components/ui/avatar";

const ROLES = ["admin", "operations_manager", "city_manager", "service_manager", "staff"];

export default function Settings() {
  const { user } = useAuth();
  const fabric = user?.industry === "fabric_order_management";
  return (
    <div>
      <PageHeader title="Settings" subtitle={fabric ? "Team members and organization" : "Rental plans, team members and organization"} />
      <Tabs defaultValue={fabric ? "org" : "plans"}>
        <TabsList className="bg-mv-surface border border-mv-border">
          {!fabric && <TabsTrigger value="plans" className="data-[state=active]:bg-mv-elevated">Rental Plans</TabsTrigger>}
          {["admin", "operations_manager"].includes(user?.role) && <TabsTrigger value="team" className="data-[state=active]:bg-mv-elevated">Team</TabsTrigger>}
          <TabsTrigger value="org" className="data-[state=active]:bg-mv-elevated">Organization</TabsTrigger>
        </TabsList>
        {!fabric && <TabsContent value="plans" className="mt-4"><Plans /></TabsContent>}
        <TabsContent value="team" className="mt-4"><Team currentUser={user} /></TabsContent>
        <TabsContent value="org" className="mt-4"><Org user={user} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Plans() {
  const { user } = useAuth();
  const [plans, setPlans] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const canEdit = ["admin", "operations_manager"].includes(user?.role);
  const { city } = useApp();
  const load = () => api.get("/rental-plans").then((r) => {
    setPlans(city === "all" ? r.data : r.data.filter(p => !p.cities || p.cities.length === 0 || p.cities.includes(city)));
  });
  useEffect(() => { load(); }, [city]);
  return (
    <div>
      <div className="flex justify-end mb-4">{canEdit && <PrimaryBtn onClick={() => setShowNew(true)} data-testid="add-plan-btn"><Plus className="w-4 h-4" /> New Plan</PrimaryBtn>}</div>
      {!plans && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>}
      {plans && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.id} className="mv-card p-5">
              <div className="flex items-center justify-between"><span className="font-display font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4 text-mv-primary" /> {p.name}</span><StatusChip status={p.active ? "active" : "inactive"} label={p.active ? "Active" : "Inactive"} /></div>
              <div className="font-display text-3xl font-bold mt-3">{inr(p.amount)}</div>
              <div className="text-xs text-mv-dim mt-1">{p.duration_days} day(s)</div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                <div><div className="mv-label">Deposit</div>{inr(p.deposit)}</div>
                <div><div className="mv-label">Late Fee</div>{inr(p.late_fee)}</div>
                <div><div className="mv-label">Grace</div>{p.grace_period_days}d</div>
                <div><div className="mv-label">Cities</div>{(p.cities || []).length || "All"}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <NewPlanDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
    </div>
  );
}

function NewPlanDialog({ open, setOpen, onDone }) {
  const [form, setForm] = useState({ name: "", amount: 0, duration_days: 1, deposit: 0, grace_period_days: 1, late_fee: 0, active: true });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name) { toast.error("Name required"); return; }
    try { await api.post("/rental-plans", { ...form, amount: Number(form.amount), duration_days: Number(form.duration_days), deposit: Number(form.deposit), grace_period_days: Number(form.grace_period_days), late_fee: Number(form.late_fee), cities: CITIES }); toast.success("Plan created ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">New Rental Plan</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Monthly Rental" /></Field>
          <Field label="Amount (₹)"><TextInput type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Duration (days)"><TextInput type="number" value={form.duration_days} onChange={(e) => set("duration_days", e.target.value)} /></Field>
          <Field label="Deposit (₹)"><TextInput type="number" value={form.deposit} onChange={(e) => set("deposit", e.target.value)} /></Field>
          <Field label="Grace (days)"><TextInput type="number" value={form.grace_period_days} onChange={(e) => set("grace_period_days", e.target.value)} /></Field>
          <Field label="Late Fee (₹)"><TextInput type="number" value={form.late_fee} onChange={(e) => set("late_fee", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-plan-btn">Create Plan</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function Team({ currentUser }) {
  const [users, setUsers] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  
  const { city } = useApp();
  const load = () => api.get("/users").then((r) => {
    setUsers(city === "all" ? r.data : r.data.filter(u => u.city === city));
  }).catch(() => setUsers([]));
  useEffect(() => { load(); }, [city]);
  
  const handleDelete = async (id) => {
    if (window.confirm("Are you sure you want to permanently delete this team member?")) {
      try {
        await api.delete(`/users/${id}`);
        toast.success("Member deleted ✓");
        load();
      } catch (e) {
        toast.error("Failed to delete member");
      }
    }
  };

  return (
    <div>
      {currentUser?.role === "admin" && <div className="flex justify-end mb-4"><PrimaryBtn onClick={() => setShowNew(true)} data-testid="add-user-btn"><Plus className="w-4 h-4" /> Add Member</PrimaryBtn></div>}
      {!users && <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>}
      {users && (
        <div className="mv-card divide-y divide-mv-border">
          {users.map((u) => (
            <div key={u.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar className="w-9 h-9"><AvatarFallback className="bg-mv-elevated text-xs">{(u.name || "U").split(" ").map((s) => s[0]).slice(0, 2).join("")}</AvatarFallback></Avatar>
                <div>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-mv-dim">{u.phone || u.email}{u.city ? ` · ${u.city}` : ""}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <StatusChip status="blue" label={roleLabel(u.role)} />
                {currentUser?.role === "admin" && u.id !== currentUser.id && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingUser(u)} className="p-1.5 text-mv-muted hover:text-mv-text transition-colors rounded-lg hover:bg-mv-surface2">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => handleDelete(u.id)} className="p-1.5 text-mv-muted hover:text-red-500 transition-colors rounded-lg hover:bg-mv-surface2">
                      <Trash className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <NewUserDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <EditUserDialog user={editingUser} setOpen={(v) => { if (!v) setEditingUser(null); }} onDone={() => { setEditingUser(null); load(); }} />
    </div>
  );
}

function NewUserDialog({ open, setOpen, onDone }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", role: "staff", city: "" });
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => { if (open) { setForm({ name: "", phone: "", email: "", password: "", role: "staff", city: "" }); setShowPassword(false); } }, [open]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  
  const save = async () => {
    if (!form.name || !form.phone) { toast.error("Name and Phone required"); return; }
    if (form.role === "city_manager" && !form.city) { toast.error("City is required for City Manager"); return; }
    try { 
      await api.post("/users", { ...form }); 
      toast.success("Member added ✓"); 
      onDone(); 
    } catch (e) { 
      toast.error(e.response?.data?.detail || "Failed"); 
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Add Team Member</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone / Username"><TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email (Optional)"><TextInput type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Role"><Select value={form.role} onValueChange={(v) => set("role", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent></Select></Field>
          
          <div className="col-span-2 sm:col-span-1">
            <Field label="Password">
              <div className="relative">
                <TextInput type={showPassword ? "text" : "password"} value={form.password} onChange={(e) => set("password", e.target.value)} placeholder="Default: password123" className="pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-mv-muted hover:text-mv-text">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          </div>
          
          <div className="col-span-2 sm:col-span-1"><Field label="City (Optional)"><Select value={form.city || "all"} onValueChange={(v) => set("city", v === "all" ? "" : v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="All Cities" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="all">All Cities</SelectItem>{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field></div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-user-btn">Add Member</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, setOpen, onDone }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", role: "staff", city: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  
  useEffect(() => {
    if (user) {
      setForm({ name: user.name, phone: user.phone || "", email: user.email || "", role: user.role, city: user.city || "" });
    }
  }, [user]);

  const save = async () => {
    if (!form.name || !form.phone) { toast.error("Name and Phone required"); return; }
    if (form.role === "city_manager" && !form.city) { toast.error("City is required for City Manager"); return; }
    try { 
      await api.put(`/users/${user.id}`, { ...form, city: form.city === "all" ? "" : form.city }); 
      toast.success("Member updated ✓"); 
      onDone(); 
    } catch (e) { 
      toast.error(e.response?.data?.detail || "Failed"); 
    }
  };

  if (!user) return null;

  return (
    <Dialog open={!!user} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined} className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Team Member</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Phone / Username"><TextInput value={form.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email (Optional)"><TextInput type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Role"><Select value={form.role} onValueChange={(v) => set("role", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>)}</SelectContent></Select></Field>
          
          <div className="col-span-2 sm:col-span-1"><Field label="City (Optional)"><Select value={form.city || "all"} onValueChange={(v) => set("city", v === "all" ? "" : v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="All Cities" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text"><SelectItem value="all">All Cities</SelectItem>{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field></div>
        </div>
        <div className="flex justify-end pt-1 gap-2">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-xl text-sm font-semibold text-mv-text hover:bg-mv-surface2 transition-colors">Cancel</button>
            <PrimaryBtn onClick={save}>Save Changes</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function Org({ user }) {
    const ROLE_ACCESS = {
    admin: "Full access to all modules and settings (Global)",
    city_manager: "Assigned city only — full operational access",
  };
  return (
    <div className="space-y-4">
      <div className="mv-card p-5">
        <h3 className="font-display font-semibold flex items-center gap-2 mb-3"><Shield className="w-4 h-4 text-mv-primary" /> Organization</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div><div className="mv-label">Company</div>{user?.org_name || "Route39"}</div>
          <div><div className="mv-label">Industry</div>{user?.industry === "fabric_order_management" ? "Fabric Orders" : "Fleet & Rental"}</div>
          <div><div className="mv-label">Product</div>MyVolt</div>
          <div><div className="mv-label">Your Role</div>{roleLabel(user?.role)}</div>
          <div><div className="mv-label">Org ID</div><span className="font-mono text-xs">{user?.organization_id}</span></div>
        </div>
      </div>
      <div className="mv-card p-5">
        <h3 className="font-display font-semibold flex items-center gap-2 mb-3"><Users className="w-4 h-4 text-mv-primary" /> Roles & Permissions</h3>
        <div className="space-y-2">
          {Object.entries(ROLE_ACCESS).map(([r, desc]) => (
            <div key={r} className="flex items-start gap-3 p-3 rounded-xl bg-mv-surface2"><StatusChip status="blue" label={roleLabel(r)} /><span className="text-sm text-mv-muted">{desc}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}
