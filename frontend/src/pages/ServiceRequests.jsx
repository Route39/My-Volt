import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Plus, Wrench, Car, User, Clock, GripVertical , Trash, Pencil} from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp } from "../context/AppContext";
import { StatusChip, Skeleton } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, Field, TextInput, TextArea } from "../components/common/Page";
import { timeAgo } from "../lib/format";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const STAGES = [
  ["new", "New"], ["assigned", "Assigned"], ["inspection", "Inspection"],
  ["repair", "Repair"], ["ready", "Ready"], ["closed", "Closed"],
];
const PRIO_DOT = { critical: "bg-red-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-zinc-500" };

export default function ServiceRequests() {
  const { city } = useApp();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [items, setItems] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const handleDelete = async (id) => { if(window.confirm("Delete this?")) { try { await api.delete(`/service-requests/${id}`); toast.success("Deleted"); load(); } catch { toast.error("Failed"); } } };
  const [showNew, setShowNew] = useState(params.get("new") === "1");
  const [detail, setDetail] = useState(null);
  const [dragId, setDragId] = useState(null);
  const priorityFilter = params.get("priority");

  const load = useCallback(async () => {
    const p = {};
    if (city !== "all") p.city = city;
    if (priorityFilter) p.priority = priorityFilter;
    const { data } = await api.get("/service-requests", { params: p });
    setItems(data);
  }, [city, priorityFilter]);
  useEffect(() => { load(); }, [load]);

  const move = async (sr, status) => {
    if (sr.status === status) return;
    setItems((its) => its.map((x) => x.id === sr.id ? { ...x, status } : x));
    try { await api.put(`/service-requests/${sr.id}`, { status }); toast.success(`${sr.code} → ${status}`); load(); }
    catch { toast.error("Failed to move"); load(); }
  };

  return (
    <div>
      <PageHeader title="Service Requests" subtitle="Visual maintenance workflow · drag cards across stages">
        <PrimaryBtn onClick={() => setShowNew(true)} data-testid="create-sr-btn"><Plus className="w-4 h-4" /> New Request</PrimaryBtn>
      </PageHeader>

      {!items && <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>}

      {items && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {STAGES.map(([key, label]) => {
            const col = items.filter((s) => s.status === key);
            return (
              <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={() => { const sr = items.find((x) => x.id === dragId); if (sr) move(sr, key); setDragId(null); }}
                   className="mv-card bg-mv-surface2/50 p-2.5 min-h-[200px]">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-mv-muted">{label}</span>
                  <span className="text-xs bg-mv-elevated rounded-full px-2 py-0.5 text-mv-dim">{col.length}</span>
                </div>
                <div className="space-y-2">
                  {col.map((s) => (
                    <div key={s.id} draggable onDragStart={() => setDragId(s.id)} onClick={() => setDetail(s)}
                         data-testid={`sr-card-${s.id}`}
                         className={`mv-card p-3 cursor-grab active:cursor-grabbing hover:border-mv-primary/50 transition-colors group ${dragId === s.id ? "opacity-50" : "mv-rise"}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-mv-dim">{s.code}</span>
                        <span className={`w-2 h-2 rounded-full ${PRIO_DOT[s.priority]}`} title={s.priority} />
                      </div>
                      <div className="text-sm font-medium mt-1.5 flex items-center gap-1.5"><Wrench className="w-3.5 h-3.5 text-amber-400" /> {s.issue_type}</div>
                      <div className="mt-2 space-y-1 text-[11px] text-mv-muted">
                        <div className="flex items-center gap-1"><Car className="w-3 h-3" /> {s.vehicle_number}</div>
                        <div className="flex items-center gap-1"><User className="w-3 h-3" /> {s.driver_name || "—"} · {s.city}</div>
                        <div className="flex items-center gap-1"><Clock className="w-3 h-3" /> {timeAgo(s.created_at)}</div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <StatusChip status={s.priority} />
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                          <button onClick={(e) => { e.stopPropagation(); setEditingItem(s); }} className="p-1 hover:text-mv-primary transition-colors text-mv-dim" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="p-1 hover:text-red-500 transition-colors text-mv-dim" title="Delete"><Trash className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {col.length === 0 && <div className="text-[11px] text-mv-dim text-center py-6">Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewSRDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <SRDetail sr={detail} setSr={setDetail} onChange={load} />
      <EditSRDialog sr={editingItem} onClose={() => setEditingItem(null)} onDone={() => { setEditingItem(null); load(); }} />
    </div>
  );
}

function EditSRDialog({ sr, onClose, onDone }) {
  const [form, setForm] = useState({ issue_type: "Breakdown", priority: "high", description: "", assigned_to: "", status: "open" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => {
    if (sr) setForm({ issue_type: sr.issue_type || "Breakdown", priority: sr.priority || "high", description: sr.description || "", assigned_to: sr.assigned_to || "", status: sr.status || "open" });
  }, [sr]);
  const save = async () => {
    try { await api.put(`/service-requests/${sr.id}`, form); toast.success("Request updated ✓"); onDone(); }
    catch { toast.error("Failed to update"); }
  };
  if (!sr) return null;
  const issues = ["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"];
  return (
    <Dialog open={!!sr} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Request — {sr.code}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Issue Type">
            <Select value={form.issue_type} onValueChange={(v) => set("issue_type", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{issues.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onValueChange={(v) => set("priority", v)}>
              <SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical","high","medium","low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Assigned To"><TextInput value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)} placeholder="Name or team" /></Field>
          <Field label="Status"><TextInput value={form.status} onChange={(e) => set("status", e.target.value)} /></Field>
        </div>
        <Field label="Description"><TextArea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold text-mv-text hover:bg-mv-surface2 transition-colors">Cancel</button>
          <PrimaryBtn onClick={save}>Save Changes</PrimaryBtn>
        </div>
      </DialogContent>
    </Dialog>
  );
}


function NewSRDialog({ open, setOpen, onDone }) {
  const [vehicles, setVehicles] = useState([]);
  const [form, setForm] = useState({ vehicle_id: "", issue_type: "Breakdown", priority: "high", source: "Operations", description: "" });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  useEffect(() => { if (open) api.get("/vehicles", { params: { page_size: 200 } }).then((r) => setVehicles(r.data.items)); }, [open]);
  const save = async () => {
    const v = vehicles.find((x) => x.id === form.vehicle_id);
    if (!v) { toast.error("Select a vehicle"); return; }
    try { await api.post("/service-requests", { ...form, vehicle_number: v.vehicle_number, city: v.city, driver_id: v.current_driver_id, driver_name: v.current_driver_name }); toast.success("Service request created ✓"); onDone(); } catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">New Service Request</DialogTitle></DialogHeader>
        <Field label="Vehicle"><Select value={form.vehicle_id} onValueChange={(v) => set("vehicle_id", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border" data-testid="sr-vehicle-select"><SelectValue placeholder="Select vehicle" /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text max-h-64">{vehicles.map((v) => <SelectItem key={v.id} value={v.id}>{v.vehicle_number} · {v.city}</SelectItem>)}</SelectContent></Select></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Issue Type"><Select value={form.issue_type} onValueChange={(v) => set("issue_type", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["Breakdown", "Battery", "Tyre", "Brake", "Electrical", "Charger", "Accident", "General", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Priority"><Select value={form.priority} onValueChange={(v) => set("priority", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["critical", "high", "medium", "low"].map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent></Select></Field>
        </div>
        <Field label="Description"><TextArea rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save} data-testid="save-sr-btn">Create Request</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function SRDetail({ sr, setSr, onChange }) {
  const [assigned, setAssigned] = useState("");
  useEffect(() => { setAssigned(sr?.assigned_to || ""); }, [sr]);
  if (!sr) return null;
  const saveAssign = async () => { try { await api.put(`/service-requests/${sr.id}`, { assigned_to: assigned }); toast.success("Updated ✓"); onChange(); setSr(null); } catch { toast.error("Failed"); } };
  return (
    <Dialog open={!!sr} onOpenChange={() => setSr(null)}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text max-w-lg">
        <DialogHeader><DialogTitle className="font-display flex items-center gap-2">{sr.code} <StatusChip status={sr.priority} /></DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            {[["Vehicle", sr.vehicle_number], ["Driver", sr.driver_name || "—"], ["Issue", sr.issue_type], ["City", sr.city], ["Source", sr.source], ["Status", sr.status]].map(([k, v]) => (
              <div key={k}><div className="mv-label">{k}</div><div className="font-medium capitalize">{v}</div></div>
            ))}
          </div>
          {sr.description && <div><div className="mv-label">Description</div><p className="text-mv-muted mt-1">{sr.description}</p></div>}
          <Field label="Assigned To"><TextInput value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Technician / workshop" /></Field>
          <div><div className="mv-label mb-2">Timeline</div>
            <div className="relative pl-5 space-y-2">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-mv-border" />
              {(sr.timeline || []).map((t, i) => (<div key={i} className="relative flex items-center gap-2"><div className="absolute -left-5 w-3 h-3 rounded-full bg-mv-surface border-2 border-mv-primary" /><span className="capitalize text-mv-text">{t.stage}</span><span className="text-xs text-mv-dim">{timeAgo(t.at)}</span></div>))}
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={saveAssign}>Save</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
