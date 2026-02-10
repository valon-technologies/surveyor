"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useWorkspace } from "@/lib/hooks/use-workspace";
import { api, workspacePath } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { WORKSPACE_ROLES, WORKSPACE_ROLE_LABELS, WORKSPACE_TEAM_LABELS, type WorkspaceRole, type WorkspaceTeam } from "@/lib/constants";
import { Trash2, UserPlus, Shield } from "lucide-react";

interface Member {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  team: string | null;
  joinedAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
}

export default function MembersPage() {
  const { data: session } = useSession();
  const { workspaceId, role: myRole } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>("editor");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);

  const basePath = workspacePath(workspaceId, "");
  const isOwner = myRole === "owner";

  const fetchData = async () => {
    const [m, i] = await Promise.all([
      api.get<Member[]>(`${basePath}members`),
      isOwner ? api.get<Invite[]>(`${basePath}invites`) : Promise.resolve([]),
    ]);
    setMembers(m);
    setInvites(i);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [workspaceId]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    await api.post(`${basePath}invites`, { email: inviteEmail, role: inviteRole });
    setInviteEmail("");
    setInviting(false);
    fetchData();
  };

  const handleRevokeInvite = async (id: string) => {
    await api.delete(`${basePath}invites/${id}`);
    fetchData();
  };

  const handleChangeRole = async (userId: string, newRole: string) => {
    await api.patch(`${basePath}members/${userId}`, { role: newRole });
    fetchData();
  };

  const handleChangeTeam = async (userId: string, newTeam: string | null) => {
    await api.patch(`${basePath}members/${userId}`, { team: newTeam });
    fetchData();
  };

  const handleRemoveMember = async (userId: string) => {
    await api.delete(`${basePath}members/${userId}`);
    fetchData();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-lg font-semibold">Members</h1>

      {/* Invite form (owner only) */}
      {isOwner && (
        <div className="border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Invite a Member
          </h2>
          <div className="flex gap-2">
            <Input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email address"
              type="email"
              className="flex-1"
            />
            <Select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
              options={WORKSPACE_ROLES.filter((r) => r !== "owner").map((r) => ({
                value: r,
                label: WORKSPACE_ROLE_LABELS[r],
              }))}
              className="w-28"
            />
            <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
              {inviting ? "Sending..." : "Invite"}
            </Button>
          </div>

          {/* Pending invites */}
          {invites.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-xs text-muted-foreground">Pending Invites</p>
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between text-sm border rounded px-3 py-2">
                  <div>
                    <span>{inv.email}</span>
                    <Badge variant="outline" className="ml-2 text-[10px] capitalize">
                      {inv.role}
                    </Badge>
                  </div>
                  <button
                    onClick={() => handleRevokeInvite(inv.id)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="Revoke invite"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Members list */}
      <div className="border rounded-lg divide-y">
        {members.map((member) => (
          <div key={member.id} className="flex items-center gap-3 px-4 py-3">
            {member.image ? (
              <img src={member.image} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
                {(member.name || member.email)[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {member.name || member.email}
                {member.userId === session?.user?.id && (
                  <span className="text-muted-foreground font-normal"> (you)</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{member.email}</p>
            </div>
            {isOwner && member.userId !== session?.user?.id ? (
              <div className="flex items-center gap-2">
                <Select
                  value={member.team || ""}
                  onChange={(e) => handleChangeTeam(member.userId, e.target.value || null)}
                  options={[
                    { value: "", label: "No team" },
                    { value: "SM", label: "ServiceMac" },
                    { value: "VT", label: "Valon Tech" },
                  ]}
                  className="w-28 h-8 text-xs"
                />
                <Select
                  value={member.role}
                  onChange={(e) => handleChangeRole(member.userId, e.target.value)}
                  options={WORKSPACE_ROLES.map((r) => ({
                    value: r,
                    label: WORKSPACE_ROLE_LABELS[r],
                  }))}
                  className="w-24 h-8 text-xs"
                />
                <button
                  onClick={() => handleRemoveMember(member.userId)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Remove member"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {member.team && (
                  <Badge variant="outline" className="text-[10px]">
                    {WORKSPACE_TEAM_LABELS[member.team as WorkspaceTeam] || member.team}
                  </Badge>
                )}
                <Badge variant="outline" className="capitalize text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  {member.role}
                </Badge>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
