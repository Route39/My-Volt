import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, MapPin, ArrowRightLeft, Pencil, Trash } from "lucide-react";
import { toast } from "sonner";
import api from "../lib/api";
import { useApp, CITIES } from "../context/AppContext";
import { Skeleton, EmptyState, StatusChip } from "../components/common/Primitives";
import { PageHeader, PrimaryBtn, Field, TextInput } from "../components/common/Page";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export default function Locations() {
  const { city } = useApp();
  const [items, setItems] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [editingLoc, setEditingLoc] = useState(null);
  const handleDelete = async (id, e) => { e.stopPropagation(); if(window.confirm("Delete this location?")) { try { await api.delete(`/locations/${id}`); toast.success("Deleted"); load(); } catch { toast.error("Failed"); } } };

  const load = useCallback(async () => {
    const p = {}; if (city !== "all") p.city = city;
    const { data } = await api.get("/locations", { params: p }); setItems(data);
  }, [city]);
  useEffect(() => { load(); }, [load]);

  const byCity = {};
  (items || []).forEach((l) => { (byCity[l.city] = byCity[l.city] || []).push(l); });

  return (
    <div>
      <PageHeader title="Locations & Parking" subtitle="Depots and parking capacity across cities">
        <PrimaryBtn onClick={() => setShowNew(true)} data-testid="add-location-btn"><Plus className="w-4 h-4" /> Add Location</PrimaryBtn>
      </PageHeader>

      {!items && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>}
      {items && items.length === 0 && <EmptyState icon={MapPin} title="No parking locations yet." subtitle="Add depots and parking bays to track capacity." action={<PrimaryBtn onClick={() => setShowNew(true)}><Plus className="w-4 h-4" /> Add Location</PrimaryBtn>} />}

      {items && Object.entries(byCity).map(([c, locs]) => (
        <div key={c} className="mb-6">
          <h3 className="font-display font-semibold mb-3 flex items-center gap-2"><MapPin className="w-4 h-4 text-mv-primary" /> {c}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {locs.map((l) => {
              const pct = l.capacity ? Math.min((l.current_vehicles / l.capacity) * 100, 100) : 0;
              const color = pct > 90 ? "#ef4444" : pct > 70 ? "#f59e0b" : "#22c55e";
              return (
                <div key={l.id} className="mv-card p-5 group relative">
                  <div className="flex items-center justify-between"><span className="font-semibold">{l.name}</span>
                    <div className="flex items-center gap-2">
                      <StatusChip status="active" />
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); setEditingLoc(l); }} className="p-1 hover:text-mv-primary transition-colors text-mv-dim"><Pencil className="w-4 h-4" /></button>
                        <button onClick={(e) => handleDelete(l.id, e)} className="p-1 hover:text-red-500 transition-colors text-mv-dim"><Trash className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-mv-dim mt-1">{l.address}</div>
                  <div className="flex items-end justify-between mt-4 mb-1.5"><span className="mv-label">Capacity</span><span className="font-display font-bold">{l.current_vehicles} / {l.capacity}</span></div>
                  <div className="h-2.5 rounded-full bg-mv-elevated overflow-hidden"><div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: color }} /></div>
                  <div className="text-xs text-mv-dim mt-3">Manager: {l.manager} · {l.contact}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <NewLocationDialog open={showNew} setOpen={setShowNew} onDone={() => { setShowNew(false); load(); }} />
      <EditLocationDialog loc={editingLoc} open={!!editingLoc} setOpen={(v) => { if(!v) setEditingLoc(null); }} onDone={() => { setEditingLoc(null); load(); }} />
    </div>
  );
}


function EditLocationDialog({ loc, open, setOpen, onDone }) {
  const [form, setForm] = useState(loc || {});
  useEffect(() => { if (open && loc) setForm(loc); }, [open, loc]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name) { toast.error("Name required"); return; }
    try { await api.put(`/locations/${loc.id}`, { ...form, capacity: Number(form.capacity) }); toast.success("Updated ✓"); onDone(); }
    catch { toast.error("Failed"); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Edit Location</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Name"><TextInput value={form.name || ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="City"><Select value={form.city || "Chennai"} onValueChange={(v) => set("city", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Capacity"><TextInput type="number" value={form.capacity || 50} onChange={(e) => set("capacity", e.target.value)} /></Field>
          <Field label="Manager"><TextInput value={form.manager || ""} onChange={(e) => set("manager", e.target.value)} /></Field>
          <Field label="Address"><TextInput value={form.address || ""} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Contact"><TextInput value={form.contact || ""} onChange={(e) => set("contact", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save}>Save Changes</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}

function NewLocationDialog({ open, setOpen, onDone }) {
  const [form, setForm] = useState({ name: "", city: "Chennai", address: "", capacity: 50, manager: "", contact: "", status: "active" });
  useEffect(() => { if(open) setForm({ name: "", city: "Chennai", address: "", capacity: 50, manager: "", contact: "", status: "active" }); }, [open]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => { if (!form.name) { toast.error("Name required"); return; } try { await api.post("/locations", { ...form, capacity: Number(form.capacity) }); toast.success("Location added ✓"); onDone(); } catch { toast.error("Failed"); } };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="bg-mv-surface border-mv-border text-mv-text">
        <DialogHeader><DialogTitle className="font-display">Add Location</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4 pt-1">
          <Field label="Name"><TextInput value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="City"><Select value={form.city} onValueChange={(v) => set("city", v)}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{CITIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Capacity"><TextInput type="number" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} /></Field>
          <Field label="Manager"><TextInput value={form.manager} onChange={(e) => set("manager", e.target.value)} /></Field>
          <Field label="Address"><TextInput value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Contact"><TextInput value={form.contact} onChange={(e) => set("contact", e.target.value)} /></Field>
        </div>
        <div className="flex justify-end pt-1"><PrimaryBtn onClick={save}>Add Location</PrimaryBtn></div>
      </DialogContent>
    </Dialog>
  );
}
