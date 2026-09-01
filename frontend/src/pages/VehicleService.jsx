import { useAuth } from "../context/AuthContext";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Wrench, Car , Trash, Pencil} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { Skeleton, EmptyState } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, Field, TextInput, TextArea } from "../components/common/Page";
import { fmtDate, inr } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function VehicleService() {
  const { user } = useAuth();
  const { city } = useApp();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const handleDelete = async (id) => { if(window.confirm("Delete this?")) { try { await api.delete(`/vehicle-services/${id}`); toast.success("Deleted"); load(); } catch { toast.error("Failed"); } } };
  const [showNew, setShowNew] = useState(params.get("new") === "1");

  const load = useCallback(async () => {
    const p = {}; if (city !== "all") p.city = city;
    const { data } = await api.get("/vehicle-services", { params: p }); setItems(data);
  }, [city]);
  useEffect(() => { load(); }, [load]);

  const totalCost = (items || []).reduce((s, x) => s + Number(x.cost || 0), 0);

  return (
    <div>
      <PageHeader title="Vehicle Service" subtitle="Repair & maintenance records"> {user?.role === "city_manager" && <PrimaryBtn onClick={() => setShowNew(true)} data-testid="record-service-btn"><Plus className="w-4 h-4" /> Record Service</PrimaryBtn>} </PageHeader>

      {items && items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="mv-card p-4"><div className="mv-label">Records</div><div className="font-display text-2xl font-bold">{items.length}</div></div>
          <div className="mv-card p-4"><div className="mv-label">Total Cost</div><div className="font-display text-2xl font-bold">{inr(totalCost)}</div></div>
          <div className="mv-card p-4"><div className="mv-label">Avg Cost</div><div className="font-display text-2xl font-bold">{inr(items.length ? totalCost / items.length : 0)}</div></div>
          <div className="mv-card p-4"><div className="mv-label">Last Service</div><div className="text-sm font-medium mt-1">{fmtDate(items[0]?.start_date)}</div></div>
        </div>
      )}

      {!items && <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={Wrench} title="No service records yet." subtitle="Record a completed service to build vehicle history." action={user?.role === "city_manager" ? <PrimaryBtn onClick={() => setShowNew(true)}><Plus className="w-4 h-4" /> Record Service</PrimaryBtn> : null} />}

      {items && items.length > 0 && (
        <div className="mv-card divide-y divide-mv-border">
          {items.map((s) => (
            <div key={s.id} className="p-4 flex items-center justify-between hover:bg-mv-elevated transition-colors group">
              <button className="flex items-center gap-3 flex-1 text-left" onClick={() => nav(`/fleet/${s.vehicle_id}`)}>
                <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center"><Wrench className="w-4 h-4 text-amber-400" /></div>
                <div><div className="font-medium">{s.issue} · <span className="text-mv-muted">{s.vehicle_number}</span></div><div className="text-xs text-mv-dim">{fmtDate(s.start_date)} · {s.service_centre} · {s.city}</div></div>
              </button>
              <div className="flex items-center gap-3">
                <span className="font-display font-bold">{inr(s.cost)}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); setEditingItem(s); }} className="p-1.5 hover:bg-mv-surface2 rounded-lg text-mv-dim hover:text-mv-primary transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="p-1.5 hover:bg-mv-surface2 rounded-lg text-mv-dim hover:text-red-500 transition-colors" title="Delete"><Trash className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <NewServiceDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <EditServiceDialog svc={editingItem} onClose={() => setEditingItem(null)} onDone={() => { setEditingItem(null); load(); }} />
    </div>
  );
}

function EditServiceDialog({ svc, onClose, onDone }) {
  const [form, setForm] = useState({ issue: "", service_centre: "", technician: "", cost: 0, labour: 0, warranty: "", work_performed: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (svc) setForm({ issue: svc.issue || "", service_centre: svc.service_centre || "", technician: svc.technician || "", cost: svc.cost || 0, labour: svc.labour || 0, warranty: svc.warranty || "", work_performed: svc.work_performed || "" });
  }, [svc]);
  const save = async () => {
    try { await api.put(`/vehicle-services/${svc.id}`, { ...form, cost: Number(form.cost), labour: Number(form.labour) }); toast.success("Service updated ✓"); onDone(); }
    catch { toast.error("Failed to update"); }
  };
  if (!svc) return null;
  return (
    <Dialog open={!!svc} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg">
        <DialogHeader><DialogTitle className="font-display">Edit Service — {svc.vehicle_number}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Issue"><TextInput value={form.issue} onChange={(e) => set("issue", e.target.value)} /></Field>
          <Field label="Service Centre"><TextInput value={form.service_centre} onChange={(e) => set("service_centre", e.target.value)} /></Field>
          <Field label="Technician"><TextInput value={form.technician} onChange={(e) => set("technician", e.target.value)} /></Field>
          <Field label="Warranty"><TextInput value={form.warranty} onChange={(e) => set("warranty", e.target.value)} /></Field>
          <Field label="Cost (₹)"><TextInput type="number" value={form.cost} onChange={(e) => set("cost", e.target.value)} /></Field>
          <Field label="Labour (₹)"><TextInput type="number" value={form.labour} onChange={(e) => set("labour", e.target.value)} /></Field>
        </div>
        <Field label="Work Performed"><TextArea rows={2} value={form.work_performed} onChange={(e) => set("work_performed", e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-mv-text hover:bg-mv-surface2 transition-colors">Cancel</button>
          <PrimaryBtn onClick={save}>Save Changes</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function NewServiceDialog({ open, setOpen, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ vehicle_id: "", service_request_id: "", service_centre: "", technician: "", issue: "", work_performed: "", cost: 0, labour: 0, warranty: "3 months", start_date: new Date().toISOString().slice(0, 10), completion_date: new Date().toISOString().slice(0, 10), next_service_date: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) { api.get("/vehicles", { params: { page_size: 200 } }).then((r) => setVehicles(r.data.items)); api.get("/service-requests").then((r) => setRequests(r.data.filter((x) => x.status !== "closed"))); } }, [open]);
  const save = async () => {
    const v = vehicles.find((x) => x.id === form.vehicle_id);
    if (!v) { toast.error("Select a vehicle"); return; }
    const body = { ...form, vehicle_number: v.vehicle_number, city: v.city, cost: Number(form.cost), labour: Number(form.labour), start_date: new Date(form.start_date).toISOString(), completion_date: new Date(form.completion_date).toISOString(), next_service_date: form.next_service_date ? new Date(form.next_service_date).toISOString() : null, parts: [] };
    if (!body.service_request_id) delete body.service_request_id;
    try { await api.post("/vehicle-services", body); toast.success("Vehicle service completed ✓"); onDone(); } catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="font-display">Record Vehicle Service</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Vehicle"><Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="svc-vehicle"><SelectValue placeholder="Select" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-56">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Linked Request"><Select value={form.service_request_id} onValueChange={(v) => set("service_request_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue placeholder="Optional" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-56">{requests.map((r) => <SelectItem key={r.id} value={r.id}>{r.code} · {r.issue_type}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Service Centre"><TextInput value={form.service_centre} onChange={(e) => set("service_centre", e.target.value)} /></Field>
          <Field label="Technician"><TextInput value={form.technician} onChange={(e) => set("technician", e.target.value)} /></Field>
          <Field label="Issue"><TextInput value={form.issue} onChange={(e) => set("issue", e.target.value)} placeholder="Brake Service" /></Field>
          <Field label="Warranty"><TextInput value={form.warranty} onChange={(e) => set("warranty", e.target.value)} /></Field>
          <Field label="Cost (₹)"><TextInput type="number" value={form.cost} onChange={(e) => set("cost", e.target.value)} /></Field>
          <Field label="Labour (₹)"><TextInput type="number" value={form.labour} onChange={(e) => set("labour", e.target.value)} /></Field>
          <Field label="Start Date"><TextInput type="date" value={form.start_date} onChange={(e) => set("start_date", e.target.value)} /></Field>
          <Field label="Completion Date"><TextInput type="date" value={form.completion_date} onChange={(e) => set("completion_date", e.target.value)} /></Field>
          <Field label="Next Service"><TextInput type="date" value={form.next_service_date} onChange={(e) => set("next_service_date", e.target.value)} /></Field>
        </div>
        <Field label="Work Performed"><TextArea rows={2} value={form.work_performed} onChange={(e) => set("work_performed", e.target.value)} /></Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-service-btn">Save Service</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
