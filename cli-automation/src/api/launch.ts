/**
 * Minimal Launch API client. The `cli-for-launch` doc's own CLI has no
 * delete command for projects (confirmed via --help and the doc's own
 * Limitations section — "does not support modifying settings for existing
 * projects"), so teardown for a real-created Launch project goes through
 * this API directly, the same way stack teardown bypasses the CLI too.
 *
 * One quirk discovered by hand: DELETE requires an explicit `{}` JSON body.
 * A request with no body at all returns 400 with no useful detail; the
 * exact same request with `{}` returns 204 and genuinely deletes the
 * project (verified: a follow-up GET /projects no longer lists it).
 */
import "dotenv/config";
import { getAuthtoken } from "./contentstack.js";

// Launch is currently only available in this NA endpoint regardless of the
// account's Management API region setting.
const LAUNCH_HOST = "https://launch-api.contentstack.com";

async function launchApi(method: string, path: string, body: unknown = null): Promise<{ status: number; data: any }> {
  const authtoken = await getAuthtoken();
  const res = await fetch(`${LAUNCH_HOST}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      authtoken,
      organization_uid: process.env.CONTENTSTACK_ORG_ID ?? "",
    },
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export interface LaunchProject {
  uid: string;
  name: string;
  createdAt: string;
}

export async function listLaunchProjects(): Promise<LaunchProject[]> {
  const { data } = await launchApi("GET", "/projects");
  return data.projects ?? [];
}

export async function findLaunchProjectByName(name: string): Promise<LaunchProject | undefined> {
  const projects = await listLaunchProjects();
  return projects.find((p) => p.name === name);
}

export async function getLaunchEnvironmentUid(projectUid: string): Promise<string | undefined> {
  const { data } = await launchApi("GET", `/projects/${projectUid}/environments`);
  return data.environments?.[0]?.uid;
}

export interface LaunchDeployment {
  uid: string;
  status: string;
  createdAt: string;
}

export async function listLaunchDeployments(projectUid: string, environmentUid: string): Promise<LaunchDeployment[]> {
  const { data } = await launchApi("GET", `/projects/${projectUid}/environments/${environmentUid}/deployments`);
  return data.deployments ?? [];
}

/**
 * The deployment eligible for rollback, verified by hand: `launch:rollback`
 * only offers exactly ONE eligible deployment — the most recently ARCHIVED
 * one (index 1 in the newest-first list, i.e. the one right before the
 * current LIVE deployment), not just any older ARCHIVED entry. Passing an
 * older one fails with "Provided deployment UID is not rollback-eligible".
 */
export async function findEligibleRollbackDeployment(
  projectUid: string,
  environmentUid: string
): Promise<string | undefined> {
  const deployments = await listLaunchDeployments(projectUid, environmentUid);
  return deployments.find((d) => d.status === "ARCHIVED")?.uid;
}

/** Delete a Launch project, verified. See the `{}` body note above. */
export async function deleteLaunchProject(projectUid: string): Promise<boolean> {
  const { status } = await launchApi("DELETE", `/projects/${projectUid}`, {});
  if (status !== 204 && status !== 200) return false;
  const projects = await listLaunchProjects();
  return !projects.some((p) => p.uid === projectUid);
}
