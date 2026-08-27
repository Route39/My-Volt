import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, User, Package, Calendar, Paperclip, Trash2, Upload, Image as ImageIcon, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import api from "../../lib/api";
import { StatusChip, Skeleton } from "../../components/common/Primitives";
import { Field, TextInput, TextArea, PrimaryBtn, GhostBtn } from "../../components/common/Page";
import { fmtDate, inr, timeAgo } from "../../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";

const STATUSES = ["received", "processing", "on_hold", "completed"];

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [o, setO] = useState(null);
  const [notes, setNotes] = useState("");
  const [pay, setPay] = useState({ payment_status: "pending", total_amount: 0, paid_amount: 0 });
  const [lightbox, setLightbox] = useState(null);
  const fileRef = useRef();

  const load = useCallback(async () => {
    const { data } = await api.get(`/orders/${id}`);
    setO(data); setNotes(data.notes || "");
    setPay({ payment_status: data.payment_status, total_amount: data.total_amount || 0, paid_amount: data.paid_amount || 0 });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!o) return <div className="space-y-4"><Skeleton className="h-40 rounded-2xl" /><Skeleton className="h-64 rounded-2xl" /></div>;

  const setStatus = async (status) => { try { await api.put(`/orders/${id}`, { status }); toast.success(status === "completed" ? "Order completed ✓" : `Moved to ${status.replace("_", " ")}`); load(); } catch { toast.error("Failed"); } };
  const saveNotes = async () => { try { await api.put(`/orders/${id}`, { notes }); toast.success("Notes saved ✓"); load(); } catch { toast.error("Failed"); } };
  const savePay = async () => { try { await api.put(`/orders/${id}`, { ...pay, total_amount: Number(pay.total_amount), paid_amount: Number(pay.paid_amount) }); toast.success("Payment updated ✓"); load(); } catch { toast.error("Failed"); } };

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} exceeds 10 MB`); continue; }
      const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
      try { await api.post(`/orders/${id}/attachments`, { name: f.name, type: f.type, size: f.size, data }); }
      catch (err) { toast.error(err.response?.data?.detail || "Upload failed"); }
    }
    toast.success("Attachment uploaded ✓"); if (fileRef.current) fileRef.current.value = ""; load();
  };
  const delAtt = async (aid) => { try { await api.delete(`/orders/${id}/attachments/${aid}`); toast.success("Removed"); load(); } catch { toast.error("Failed"); } };

  return (
    <div>
      <button onClick={() => nav("/orders")} className="flex items-center gap-1.5 text-sm text-mv-muted hover:text-mv-text mb-4"><ArrowLeft className="w-4 h-4" /> Orders</button>

      <div className="mv-card p-6 mv-rise">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-2xl font-bold">{o.order_number}</h1>
              <StatusChip status={o.status} />
              {o.status !== "completed" && <StatusChip status={o.due_status} />}
              <StatusChip status={o.priority} />
            </div>
            <button onClick={() => nav(`/customers/${o.customer_id}`)} className="text-mv-muted text-sm mt-1 hover:text-mv-text">{o.customer_name} · {o.customer_phone}</button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={o.status} onValueChange={setStatus}>
              <SelectTrigger className="w-40 h-9 bg-mv-surface border-mv-border capitalize" data-testid="order-status-select"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-mv-surface border-mv-border text-mv-text">{STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>)}</SelectContent>
            </Select>
            {o.status !== "completed" && <PrimaryBtn onClick={() => setStatus("completed")} data-testid="complete-order-btn"><CheckCircle2 className="w-4 h-4" /> Complete</PrimaryBtn>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className="lg:col-span-2 space-y-4">
          <div className="mv-card p-5">
            <h3 className="font-display font-semibold mb-3">Order Information</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[["Product / Fabric", o.product], ["Quantity", o.quantity ? `${o.quantity} ${o.unit || ""}` : "—"], ["Order Date", fmtDate(o.order_date)], ["Due Date", fmtDate(o.due_date)], ["Assigned", o.assigned_to || "Unassigned"], ["Priority", o.priority]].map(([k, v]) => (
                <div key={k}><div className="mv-label">{k}</div><div className="font-medium mt-0.5 capitalize">{v || "—"}</div></div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="mv-card p-5">
            <div className="flex items-center justify-between mb-2"><h3 className="font-display font-semibold">Notes</h3><GhostBtn onClick={saveNotes} data-testid="save-notes-btn"><Save className="w-4 h-4" /> Save</GhostBtn></div>
            <TextArea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Customer requests, delivery notes, reference details…" data-testid="order-notes" />
          </div>

          {/* Attachments */}
          <div className="mv-card p-5">
            <div className="flex items-center justify-between mb-3"><h3 className="font-display font-semibold flex items-center gap-2"><Paperclip className="w-4 h-4" /> Attachments</h3>
              <div><input ref={fileRef} type="file" multiple className="hidden" onChange={upload} data-testid="attachment-input" accept="image/*,application/pdf" />
                <GhostBtn onClick={() => fileRef.current?.click()} data-testid="upload-attachment-btn"><Upload className="w-4 h-4" /> Upload</GhostBtn></div>
            </div>
            {(o.attachments || []).length === 0 ? <div className="py-8 text-center text-mv-dim text-sm">No attachments. Add design or reference files.</div> : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {o.attachments.map((a) => (
                  <div key={a.id} className="mv-card overflow-hidden group relative">
                    {a.type?.startsWith("image/") ? (
                      <img src={a.data} alt={a.name} onClick={() => setLightbox(a)} className="w-full h-24 object-cover cursor-zoom-in" />
                    ) : (
                      <a href={a.data} download={a.name} className="w-full h-24 flex items-center justify-center bg-mv-surface2"><Paperclip className="w-6 h-6 text-mv-dim" /></a>
                    )}
                    <div className="p-2 flex items-center justify-between gap-1">
                      <span className="text-[11px] truncate">{a.name}</span>
                      <button onClick={() => delAtt(a.id)} className="text-mv-dim hover:text-red-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {/* Payment */}
          <div className="mv-card p-5">
            <h3 className="font-display font-semibold mb-3">Payment</h3>
            <div className="space-y-3">
              <Field label="Total Amount (₹)"><TextInput type="number" value={pay.total_amount} onChange={(e) => setPay((p) => ({ ...p, total_amount: e.target.value }))} /></Field>
              <Field label="Paid Amount (₹)"><TextInput type="number" value={pay.paid_amount} onChange={(e) => setPay((p) => ({ ...p, paid_amount: e.target.value }))} /></Field>
              <div className="flex justify-between text-sm"><span className="text-mv-muted">Balance</span><span className="font-semibold text-red-500">{inr(Math.max((pay.total_amount || 0) - (pay.paid_amount || 0), 0))}</span></div>
              <Field label="Status"><Select value={pay.payment_status} onValueChange={(v) => setPay((p) => ({ ...p, payment_status: v }))}><SelectTrigger className="h-10 bg-mv-surface2 border-mv-border"><SelectValue /></SelectTrigger><SelectContent className="bg-mv-surface border-mv-border text-mv-text">{["pending", "partial", "paid"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select></Field>
              <PrimaryBtn onClick={savePay} className="w-full" data-testid="save-payment-btn">Update Payment</PrimaryBtn>
            </div>
          </div>

          {/* Timeline */}
          <div className="mv-card p-5">
            <h3 className="font-display font-semibold mb-3">Activity Timeline</h3>
            <div className="relative pl-5 space-y-3">
              <div className="absolute left-[7px] top-1 bottom-1 w-px bg-mv-border" />
              {(o.timeline || []).slice().reverse().map((t, i) => (
                <div key={i} className="relative">
                  <div className="absolute -left-5 w-3 h-3 rounded-full bg-mv-surface border-2 border-mv-primary" />
                  <div className="text-sm text-mv-text">{t.text}</div>
                  <div className="text-[11px] text-mv-dim">{t.by ? `${t.by} · ` : ""}{timeAgo(t.at)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm" onClick={() => setLightbox(null)}>
          <img src={lightbox.data} alt={lightbox.name} className="max-h-[85vh] max-w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}
