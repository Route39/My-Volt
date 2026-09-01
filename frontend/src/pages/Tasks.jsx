import { useEffect, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus, Calendar, MessageSquare, CheckSquare, X, KanbanSquare, Clock } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "../lib/api";
import { useAuth } from "../context/AuthContext";

import { EmptyState } from "../components/common/Primitives";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";
import { PRIORITY, shortDate } from "../lib/format";

const PRIORITY_OPTS = ["low", "medium", "high"];
const COLUMNS = [
  { id: "todo", label: "To Do", accent: "bg-slate-400", text: "text-slate-600" },
  { id: "in_progress", label: "In Progress", accent: "bg-blue-500", text: "text-blue-600" },
  { id: "completed", label: "Completed", accent: "bg-emerald-500", text: "text-emerald-600" },
];

function formatDateTime(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Avatar({ name, size = 28 }) {
  const initials = (name || "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const colors = ["bg-violet-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500"];
  const color = colors[(name || "").charCodeAt(0) % colors.length];
  return (
    <div
      className={`flex items-center justify-center rounded-full ${color} text-white font-semibold flex-shrink-0`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}

function StatusBadge({ status }) {
  const col = COLUMNS.find((c) => c.id === status) || COLUMNS[0];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${col.text}`} style={{background:"rgba(0,0,0,0.04)"}}>
      <span className={`w-1.5 h-1.5 rounded-full ${col.accent}`} />
      {col.label}
    </span>
  );
}

function MiniProgress({ done, total }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${done === total ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function KanbanBoard({ tasks, setTasks, onTaskClick, isAdmin, emps, onCreated }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [cityFilter, setCityFilter] = useState("All");

  const onDragEnd = async (result) => {
    const { destination, draggableId, source } = result;
    if (!destination || destination.droppableId === source.droppableId) return;
    const newStatus = destination.droppableId;
    setTasks((prev) => prev.map((t) => (t.id === draggableId ? { ...t, status: newStatus } : t)));
    if (newStatus === "completed") toast.success("Task completed 🎉");
    try { await api.put(`/tasks/${draggableId}/status`, { status: newStatus }); }
    catch (e) { toast.error("Failed to move task"); }
  };

  let displayTasks = tasks;
  if (isAdmin && cityFilter !== "All") {
    const empMap = {};
    emps.forEach(e => empMap[e.id] = e.city);
    displayTasks = tasks.filter(t => empMap[t.assignee_id] === cityFilter);
  }

  const grouped = (col) => displayTasks.filter((t) => t.status === col);
  const cities = ["All", ...new Set(emps.map(e => e.city).filter(Boolean))];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-3xl font-bold text-slate-900 tracking-tight">Tasks</h1>
          <p className="text-slate-500 text-sm mt-0.5">{isAdmin ? "Assign and monitor tasks across your city managers" : "Drag cards to update their status"}</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Select value={cityFilter} onValueChange={setCityFilter}>
              <SelectTrigger className="w-[180px] rounded-xl bg-white"><SelectValue placeholder="Filter by City" /></SelectTrigger>
              <SelectContent>
                {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {isAdmin && <CreateTask emps={emps} open={createOpen} setOpen={setCreateOpen} onCreated={onCreated} />}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-2xl bg-white border border-slate-200">
          <EmptyState icon={KanbanSquare} title={isAdmin ? "No tasks yet" : "All caught up 🎉"} subtitle={isAdmin ? "Create a task and assign it to a city manager." : "No tasks assigned to you yet."} />
        </div>
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="grid md:grid-cols-3 gap-4">
            {COLUMNS.map((col) => (
              <Droppable droppableId={col.id} key={col.id}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    data-testid={`column-${col.id}`}
                    className={`rounded-2xl border p-3 min-h-[320px] transition-colors ${snapshot.isDraggingOver ? "bg-emerald-50/60 border-emerald-200" : "bg-slate-100/50 border-slate-100"}`}
                  >
                    <div className="flex items-center gap-2 px-1 mb-3">
                      <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                      <h3 className="font-heading font-semibold text-slate-700 text-sm">{col.label}</h3>
                      <span className="text-xs font-medium text-slate-500 bg-white rounded-full px-2 py-0.5 ml-auto">{grouped(col.id).length}</span>
                    </div>
                    <div className="space-y-2">
                      {grouped(col.id).map((t, index) => {
                        const checklist = t.checklist || [];
                        const done = checklist.filter((c) => c.done).length;
                        const total = checklist.length;
                        return (
                          <Draggable draggableId={t.id} index={index} key={t.id}>
                            {(drag, dragSnap) => (
                              <div
                                ref={drag.innerRef}
                                {...drag.draggableProps}
                                {...drag.dragHandleProps}
                                onClick={() => onTaskClick(t)}
                                className={`bg-white rounded-xl p-3 border border-slate-100 shadow-sm cursor-pointer hover:shadow-md transition-shadow ${dragSnap.isDragging ? "shadow-lg rotate-1" : ""}`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${PRIORITY[t.priority?.toLowerCase() || "medium"]?.color || ""}`}>
                                    {t.priority || "medium"}
                                  </span>
                                  {isAdmin && t.assignee_name && (
                                    <div className="flex items-center gap-1">
                                      <Avatar name={t.assignee_name} size={16} />
                                      <span className="text-[10px] text-slate-500 font-medium truncate max-w-[80px]">{t.assignee_name}</span>
                                    </div>
                                  )}
                                </div>
                                <p className="font-medium text-slate-800 text-sm leading-snug">{t.title}</p>
                                {total > 0 && (
                                  <div className="mt-3">
                                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                                      <span>Checklist</span><span>{done}/{total}</span>
                                    </div>
                                    <MiniProgress done={done} total={total} />
                                  </div>
                                )}
                                <div className="flex flex-col gap-1.5 mt-3 pt-2 border-t border-slate-100">
                                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Assigned: {formatDateTime(t.created_at) || "N/A"}</span>
                                  </div>
                                  {t.updated_at && (
                                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Updated: {formatDateTime(t.updated_at)}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                                  {t.due_date && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{shortDate(t.due_date)}</span>}
                                  {(t.comments || []).length > 0 && <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{t.comments.length}</span>}
                                  {total > 0 && <span className="flex items-center gap-1 ml-auto"><CheckSquare className="w-3 h-3" />{done}/{total}</span>}
                                </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                    </div>
                    {provided.placeholder}
                    {grouped(col.id).length === 0 && <p className="text-center text-xs text-slate-300 py-8">Drop tasks here</p>}
                  </div>
                )}
              </Droppable>
            ))}
          </div>
        </DragDropContext>
      )}
    </div>
  );
}

function CreateTask({ emps, open, setOpen, onCreated }) {
  const [form, setForm] = useState({ title: "", description: "", assignee_id: "", due_date: new Date().toISOString().slice(0, 10), priority: "medium" });
  const [checklist, setChecklist] = useState([""]);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setForm({ title: "", description: "", assignee_id: "", due_date: new Date().toISOString().slice(0, 10), priority: "medium" });
    setChecklist([""]);
  };

  const submit = async () => {
    setBusy(true);
    try {
      const payload = { ...form, checklist: checklist.filter(c => c.trim()) };
      await api.post("/tasks", payload);
      toast.success("Task created");
      setOpen(false);
      reset();
      onCreated();
    } catch (err) {
      toast.error(formatApiErrorDetail(err) || "Failed to create task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="rounded-xl bg-emerald-600 hover:bg-emerald-700 shadow-sm" data-testid="task-new">
          <Plus className="w-4 h-4 mr-2" />
          Create Task
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">New Task</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Task Title</Label>
            <Input className="rounded-xl mt-1" placeholder="e.g. Inspect charging station at Hub 1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="task-title" />
          </div>
          <div>
            <Label>Description (Optional)</Label>
            <Textarea className="rounded-xl mt-1 h-20 resize-none" placeholder="Add more details..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Assignee</Label>
              <Select value={form.assignee_id} onValueChange={(v) => { const u = emps.find(e => e.id === v); setForm({ ...form, assignee_id: v, assignee_name: u?.name }); }}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue placeholder="Select staff" /></SelectTrigger>
                <SelectContent>
                  {emps.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      <div className="flex items-center gap-2"><Avatar name={e.name} size={20} />{e.name}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger className="rounded-xl mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTS.map((p) => <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Due date</Label><Input type="date" className="rounded-xl mt-1" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
          <div>
            <Label>Checklist</Label>
            <div className="space-y-2 mt-1">
              {checklist.map((c, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="rounded-xl" value={c} placeholder={`Item ${i + 1}`} onChange={(e) => { const n = [...checklist]; n[i] = e.target.value; setChecklist(n); }} />
                  {checklist.length > 1 && <button onClick={() => setChecklist(checklist.filter((_, x) => x !== i))} className="text-slate-400"><X className="w-4 h-4" /></button>}
                </div>
              ))}
              <button onClick={() => setChecklist([...checklist, ""])} className="text-sm text-emerald-600 font-medium">+ Add item</button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button data-testid="task-save" onClick={submit} disabled={busy || !form.title} className="rounded-xl bg-emerald-600 hover:bg-emerald-700">
            {busy ? "Creating…" : "Create Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskDetail({ task, setTask, onChange, canDelete, canChangeStatus }) {
  const [t, setT] = useState(task);
  const [comment, setComment] = useState("");
  const [newItem, setNewItem] = useState("");
  const refresh = async () => { const { data } = await api.get(`/tasks/${task.id}`); setT(data); onChange(); };
  const toggle = async (itemId, done) => { await api.put(`/tasks/${t.id}/checklist`, { item_id: itemId, done }); refresh(); };
  const addItem = async () => { if (!newItem.trim()) return; await api.post(`/tasks/${t.id}/checklist`, { text: newItem }); setNewItem(""); refresh(); };
  const addComment = async () => { if (!comment.trim()) return; await api.post(`/tasks/${t.id}/comments`, { text: comment }); setComment(""); refresh(); };
  const changeStatus = async (s) => { await api.put(`/tasks/${t.id}/status`, { status: s }); setT({ ...t, status: s }); onChange(); if (s === "completed") toast.success("Task completed 🎉"); };
  const del = async () => { await api.delete(`/tasks/${t.id}`); toast.success("Task deleted"); setTask(null); onChange(); };
  const checklist = t.checklist || [];
  const comments = t.comments || [];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <Dialog open onOpenChange={() => setTask(null)}>
      <DialogContent className="rounded-2xl max-w-lg max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${PRIORITY[t.priority?.toLowerCase() || "medium"]?.color || ""}`}>
              {t.priority || "medium"}
            </span>
            <StatusBadge status={t.status} />
          </div>
          <DialogTitle className="font-heading text-xl">{t.title}</DialogTitle>
        </DialogHeader>
        {t.description && <p className="text-sm text-slate-600">{t.description}</p>}
        <div className="flex items-center gap-4 text-sm text-slate-500">
          {t.assignee_name && (
            <span className="flex items-center gap-2">
              <Avatar name={t.assignee_name} size={24} />
              {t.assignee_name}
            </span>
          )}
          {t.due_date && <span className="flex items-center gap-1"><Calendar className="w-4 h-4" />{shortDate(t.due_date)}</span>}
        </div>
        {canChangeStatus && (
          <div>
            <Label className="text-xs text-slate-500 uppercase tracking-wide">Update Status</Label>
            <Select value={t.status} onValueChange={changeStatus}>
              <SelectTrigger className="rounded-xl w-full mt-1" data-testid="detail-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COLUMNS.map((col) => <SelectItem key={col.id} value={col.id}>{col.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-700">Checklist</p>
            {checklist.length > 0 && <span className="text-xs text-slate-400">{doneCount}/{checklist.length}</span>}
          </div>
          {checklist.length > 0 && <MiniProgress done={doneCount} total={checklist.length} />}
          <div className="space-y-1.5 mt-2">
            {checklist.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 text-sm cursor-pointer">
                <Checkbox checked={c.done} onCheckedChange={(v) => toggle(c.id, !!v)} data-testid={`check-${c.id}`} disabled={!canChangeStatus} />
                <span className={c.done ? "line-through text-slate-400" : "text-slate-700"}>{c.text}</span>
              </label>
            ))}
          </div>
          {canChangeStatus && (
            <div className="flex gap-2 mt-2">
              <Input className="rounded-xl h-9 text-sm" placeholder="Add item" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} />
              <Button size="sm" variant="secondary" onClick={addItem} className="rounded-xl">Add</Button>
            </div>
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">Comments</p>
          <div className="space-y-2 mb-2">
            {comments.map((c) => (
              <div key={c.id} className="bg-slate-50 rounded-xl p-2.5">
                <p className="text-sm text-slate-700">{c.text}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{c.author}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input className="rounded-xl h-9 text-sm" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="comment-input" onKeyDown={(e) => e.key === "Enter" && addComment()} />
            <Button size="sm" onClick={addComment} className="rounded-xl bg-emerald-600 hover:bg-emerald-700" data-testid="comment-send">Send</Button>
          </div>
        </div>
        {canDelete && (
          <button onClick={del} className="text-sm text-red-500 font-medium self-start">Delete task</button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Tasks() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [tasks, setTasks] = useState([]);
  const [emps, setEmps] = useState([]);
  const [active, setActive] = useState(null);

  const load = async () => {
    const { data } = await api.get("/tasks");
    setTasks(data);
  };

  useEffect(() => {
    load();
    if (isAdmin) api.get("/users").then((r) => setEmps(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <KanbanBoard 
        tasks={tasks} 
        setTasks={setTasks} 
        onTaskClick={setActive} 
        isAdmin={isAdmin}
        emps={emps}
        onCreated={load}
      />
      {active && (
        <TaskDetail
          task={active}
          setTask={setActive}
          onChange={load}
          canDelete={isAdmin}
          canChangeStatus={true} 
        />
      )}
    </div>
  );
}
