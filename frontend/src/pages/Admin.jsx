import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, Trash2, KeyRound, Copy, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchMachines } from "@/lib/api";
import { adminApi, getAdminToken, setAdminToken } from "@/lib/adminApi";

function TokenGate({ onUnlocked, error }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <form
        className="w-full max-w-sm space-y-3 rounded-2xl border border-border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setAdminToken(value.trim());
          onUnlocked();
        }}
      >
        <h1 className="font-heading text-lg font-semibold">Admin access</h1>
        <p className="text-sm text-muted-foreground">
          Enter the admin token (set as <code>ADMIN_TOKEN</code> when starting the backend).
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Admin token"
          className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-primary text-sm font-medium text-primary-foreground"
        >
          Continue
        </button>
      </form>
    </div>
  );
}

function CredentialReveal({ deviceId, deviceKey, onDismiss }) {
  return (
    <div className="mt-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium">Save these now — the key won't be shown again</span>
        <button onClick={onDismiss} aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-1 font-mono">
        <div>device_id: {deviceId}</div>
        <div className="flex items-center gap-1">
          device_key: {deviceKey}
          <button
            onClick={() => navigator.clipboard.writeText(deviceKey)}
            aria-label="Copy device key"
            className="text-muted-foreground hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [machineType, setMachineType] = useState(initial?.machineType ?? "");
  const [zone, setZone] = useState(initial?.zone ?? "");

  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, machineType, zone: zone || null });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Machine name"
        required
        className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm"
      />
      <input
        value={machineType}
        onChange={(e) => setMachineType(e.target.value)}
        placeholder="Type (e.g. rack, cardio)"
        required
        className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm"
      />
      <input
        value={zone}
        onChange={(e) => setZone(e.target.value)}
        placeholder="Zone (optional)"
        className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm"
      />
      <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
        Save
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-border px-3 text-xs">
          Cancel
        </button>
      )}
    </form>
  );
}

function GymMachines({ gymId }) {
  const [machines, setMachines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [revealed, setRevealed] = useState(null); // { deviceId, deviceKey }

  const load = useCallback(async () => {
    setMachines(await fetchMachines(gymId));
  }, [gymId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  return (
    <div className="space-y-2 border-t border-border p-4">
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading machines…</p>
      ) : (
        machines.map((m) => (
          <div key={m.id}>
            {editingId === m.id ? (
              <MachineForm
                initial={{ name: m.name, machineType: m.machine_type, zone: m.zone }}
                onCancel={() => setEditingId(null)}
                onSubmit={async (data) => {
                  await adminApi.updateMachine(m.id, data);
                  setEditingId(null);
                  await load();
                }}
              />
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.machine_type}
                    {m.zone ? ` · ${m.zone}` : ""} · {m.status}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingId(m.id)}
                    aria-label="Edit machine"
                    className="rounded-lg p-2 hover:bg-accent"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      const result = await adminApi.regenerateMachineKey(m.id);
                      setRevealed({ deviceId: result.deviceId, deviceKey: result.deviceKey });
                    }}
                    aria-label="Regenerate device key"
                    className="rounded-lg p-2 hover:bg-accent"
                    title="Regenerate device key"
                  >
                    <KeyRound className="h-4 w-4" />
                  </button>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete "${m.name}"? This can't be undone.`)) return;
                      await adminApi.deleteMachine(m.id);
                      await load();
                    }}
                    aria-label="Delete machine"
                    className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {revealed && (
        <CredentialReveal
          deviceId={revealed.deviceId}
          deviceKey={revealed.deviceKey}
          onDismiss={() => setRevealed(null)}
        />
      )}

      {adding ? (
        <MachineForm
          onCancel={() => setAdding(false)}
          onSubmit={async (data) => {
            const created = await adminApi.createMachine(gymId, data);
            setRevealed({ deviceId: created.deviceId, deviceKey: created.deviceKey });
            setAdding(false);
            await load();
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex h-9 items-center gap-1 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add machine
        </button>
      )}
    </div>
  );
}

function GymRow({ gym, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(gym.name);
  const [address, setAddress] = useState(gym.address ?? "");
  const [city, setCity] = useState(gym.city ?? "");

  return (
    <div className="rounded-2xl border border-border">
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await adminApi.updateGym(gym.id, { name, address, city });
            setEditing(false);
            onChanged();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm" />
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm" />
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm" />
          <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg border border-border px-3 text-xs">Cancel</button>
        </form>
      ) : (
        <div className="flex items-center justify-between p-4">
          <button className="flex-1 text-left" onClick={() => setExpanded((v) => !v)}>
            <div className="font-heading font-semibold">{gym.name}</div>
            <div className="text-xs text-muted-foreground">
              {[gym.address, gym.city].filter(Boolean).join(", ") || "No address"} ·{" "}
              {gym.openMachines}/{gym.totalMachines} open
            </div>
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => setEditing(true)} aria-label="Edit gym" className="rounded-lg p-2 hover:bg-accent">
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={async () => {
                if (!confirm(`Delete "${gym.name}" and all its machines? This can't be undone.`)) return;
                await adminApi.deleteGym(gym.id);
                onChanged();
              }}
              aria-label="Delete gym"
              className="rounded-lg p-2 text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {expanded && !editing && <GymMachines gymId={gym.id} />}
    </div>
  );
}

export default function Admin() {
  const [unlocked, setUnlocked] = useState(!!getAdminToken());
  const [authError, setAuthError] = useState(null);
  const [gyms, setGyms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addingGym, setAddingGym] = useState(false);
  const [newGymName, setNewGymName] = useState("");
  const [newGymAddress, setNewGymAddress] = useState("");
  const [newGymCity, setNewGymCity] = useState("");

  const load = useCallback(async () => {
    try {
      setGyms(await adminApi.listGyms());
      setAuthError(null);
    } catch (err) {
      if (err.code === "INVALID_TOKEN") {
        setAdminToken("");
        setUnlocked(false);
        setAuthError("That token was rejected — try again.");
      } else if (err.code === "NOT_CONFIGURED") {
        setAuthError("Backend has no ADMIN_TOKEN set — start it with ADMIN_TOKEN=<something> npm start.");
      }
    }
  }, []);

  useEffect(() => {
    if (unlocked) load().finally(() => setLoading(false));
  }, [unlocked, load]);

  if (!unlocked) {
    return <TokenGate error={authError} onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <Link to="/" className="mb-1 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Back to app
            </Link>
            <h1 className="font-heading text-xl font-bold">Admin</h1>
          </div>
          <button
            onClick={() => {
              setAdminToken("");
              setUnlocked(false);
            }}
            className="text-xs text-muted-foreground underline"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-5 py-6">
        {authError && <p className="text-sm text-destructive">{authError}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          gyms.map((gym) => <GymRow key={gym.id} gym={gym} onChanged={load} />)
        )}

        {addingGym ? (
          <form
            className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-border p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await adminApi.createGym({ name: newGymName, address: newGymAddress, city: newGymCity });
              setNewGymName("");
              setNewGymAddress("");
              setNewGymCity("");
              setAddingGym(false);
              await load();
            }}
          >
            <input value={newGymName} onChange={(e) => setNewGymName(e.target.value)} placeholder="Gym name" required className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm" />
            <input value={newGymAddress} onChange={(e) => setNewGymAddress(e.target.value)} placeholder="Address" className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm" />
            <input value={newGymCity} onChange={(e) => setNewGymCity(e.target.value)} placeholder="City" className="h-9 flex-1 min-w-[140px] rounded-lg border border-border bg-background px-2 text-sm" />
            <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">Save</button>
            <button type="button" onClick={() => setAddingGym(false)} className="h-9 rounded-lg border border-border px-3 text-xs">Cancel</button>
          </form>
        ) : (
          <button
            onClick={() => setAddingGym(true)}
            className={cn(
              "flex h-11 w-full items-center justify-center gap-1 rounded-2xl border border-dashed border-border text-sm text-muted-foreground hover:text-foreground"
            )}
          >
            <Plus className="h-4 w-4" /> Add gym
          </button>
        )}
      </main>
    </div>
  );
}
