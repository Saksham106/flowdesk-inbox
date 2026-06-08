import { decryptString } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const MB_BASE = "https://api.mindbodyonline.com/public/v6";

function apiKey(): string {
  const key = process.env.MINDBODY_API_KEY;
  if (!key) throw new Error("MINDBODY_API_KEY is not set");
  return key;
}

// Get stored credentials for a tenant (decrypted)
export async function getMindBodyCredentials(tenantId: string) {
  const cred = await prisma.mindBodyCredential.findUnique({ where: { tenantId } });
  if (!cred) throw new Error("MindBody not connected for this tenant");
  return {
    siteId: cred.siteId,
    username: decryptString(cred.usernameEncrypted),
    password: decryptString(cred.passwordEncrypted),
  };
}

// Exchange staff credentials for a short-lived staff token
export async function getStaffToken(siteId: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${MB_BASE}/usertoken/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Api-Key": apiKey(),
      "SiteId": siteId,
    },
    body: JSON.stringify({ Username: username, Password: password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MindBody token error (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.AccessToken as string;
}

// Returns an authenticated fetch helper for a tenant
export async function getMindBodyClient(tenantId: string) {
  const { siteId, username, password } = await getMindBodyCredentials(tenantId);
  const token = await getStaffToken(siteId, username, password);

  const headers = {
    "Content-Type": "application/json",
    "Api-Key": apiKey(),
    "SiteId": siteId,
    "Authorization": `Bearer ${token}`,
  };

  return {
    siteId,
    get: async (path: string, params?: Record<string, string>) => {
      const url = new URL(`${MB_BASE}${path}`);
      if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) throw new Error(`MindBody GET ${path} failed (${res.status})`);
      return res.json();
    },
    post: async (path: string, body: unknown) => {
      const res = await fetch(`${MB_BASE}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`MindBody POST ${path} failed (${res.status}): ${text}`);
      }
      return res.json();
    },
  };
}

export type MindBodyClient = Awaited<ReturnType<typeof getMindBodyClient>>;

// ── Client lookup ────────────────────────────────────────────────────────────

export type MBClient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate?: string;
  notes?: string;
};

export async function getClientByPhone(
  client: MindBodyClient,
  phone: string
): Promise<MBClient | null> {
  const data = await client.get("/client/clients", { SearchText: phone, Limit: "1" });
  const c = data.Clients?.[0];
  if (!c) return null;
  return {
    id: c.Id,
    firstName: c.FirstName ?? "",
    lastName: c.LastName ?? "",
    email: c.Email ?? "",
    phone: c.MobilePhone ?? c.HomePhone ?? "",
    birthDate: c.BirthDate ?? undefined,
    notes: c.Notes ?? undefined,
  };
}

export async function getClientById(
  client: MindBodyClient,
  clientId: string
): Promise<MBClient | null> {
  const data = await client.get("/client/clients", { ClientIds: clientId });
  const c = data.Clients?.[0];
  if (!c) return null;
  return {
    id: c.Id,
    firstName: c.FirstName ?? "",
    lastName: c.LastName ?? "",
    email: c.Email ?? "",
    phone: c.MobilePhone ?? c.HomePhone ?? "",
    birthDate: c.BirthDate ?? undefined,
    notes: c.Notes ?? undefined,
  };
}

// ── Appointments ─────────────────────────────────────────────────────────────

export type MBAppointment = {
  id: number;
  clientId: string;
  clientName: string;
  staffName: string;
  serviceName: string;
  startTime: Date;
  endTime: Date;
  status: string;
  locationName: string;
};

export async function getClientAppointments(
  client: MindBodyClient,
  clientId: string,
  { daysAhead = 60 }: { daysAhead?: number } = {}
): Promise<MBAppointment[]> {
  const now = new Date();
  const future = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const data = await client.get("/appointment/appointments", {
    ClientId: clientId,
    StartDate: now.toISOString(),
    EndDate: future.toISOString(),
  });

  return (data.Appointments ?? []).map((a: Record<string, unknown>) => ({
    id: a.Id as number,
    clientId: (a.ClientId as string) ?? "",
    clientName: `${(a.Client as Record<string, unknown>)?.FirstName ?? ""} ${(a.Client as Record<string, unknown>)?.LastName ?? ""}`.trim(),
    staffName: `${(a.Staff as Record<string, unknown>)?.FirstName ?? ""} ${(a.Staff as Record<string, unknown>)?.LastName ?? ""}`.trim(),
    serviceName: (a.SessionType as Record<string, unknown>)?.Name as string ?? "",
    startTime: new Date(a.StartDateTime as string),
    endTime: new Date(a.EndDateTime as string),
    status: (a.Status as string) ?? "",
    locationName: (a.Location as Record<string, unknown>)?.Name as string ?? "",
  }));
}

// ── Services ─────────────────────────────────────────────────────────────────

export type MBService = {
  id: number;
  name: string;
  price: number;
  duration: number;
};

export async function getServices(client: MindBodyClient): Promise<MBService[]> {
  const data = await client.get("/site/sessiontypes");
  return (data.SessionTypes ?? []).map((s: Record<string, unknown>) => ({
    id: s.Id as number,
    name: s.Name as string,
    price: (s.DefaultTimeLength as number) ?? 0,
    duration: (s.DefaultTimeLength as number) ?? 60,
  }));
}

// ── Book appointment ─────────────────────────────────────────────────────────

export async function bookAppointment(
  client: MindBodyClient,
  {
    clientId,
    staffId,
    sessionTypeId,
    startDateTime,
    locationId = 1,
  }: {
    clientId: string;
    staffId: number;
    sessionTypeId: number;
    startDateTime: Date;
    locationId?: number;
  }
): Promise<MBAppointment> {
  const data = await client.post("/appointment/addappointment", {
    ClientId: clientId,
    StaffId: staffId,
    SessionTypeId: sessionTypeId,
    StartDateTime: startDateTime.toISOString(),
    LocationId: locationId,
  });

  const a = data.Appointment;
  return {
    id: a.Id,
    clientId: a.ClientId ?? "",
    clientName: `${a.Client?.FirstName ?? ""} ${a.Client?.LastName ?? ""}`.trim(),
    staffName: `${a.Staff?.FirstName ?? ""} ${a.Staff?.LastName ?? ""}`.trim(),
    serviceName: a.SessionType?.Name ?? "",
    startTime: new Date(a.StartDateTime),
    endTime: new Date(a.EndDateTime),
    status: a.Status ?? "",
    locationName: a.Location?.Name ?? "",
  };
}
