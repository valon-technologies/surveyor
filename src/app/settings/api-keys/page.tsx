"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Key, Trash2, Plus, Check, Eye, EyeOff } from "lucide-react";

interface ApiKeyInfo {
  id: string;
  provider: string;
  keyPrefix: string;
  createdAt: string;
  updatedAt: string;
}

const PROVIDERS = [
  { id: "claude", label: "Claude (Anthropic)", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI", placeholder: "sk-..." },
];

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingProvider, setAddingProvider] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchKeys = async () => {
    const data = await api.get<ApiKeyInfo[]>("/api/user/api-keys");
    setKeys(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleSave = async (provider: string) => {
    if (!newKey.trim()) return;
    setSaving(true);
    await api.post("/api/user/api-keys", { provider, apiKey: newKey });
    setNewKey("");
    setAddingProvider(null);
    setShowKey(false);
    setSaving(false);
    fetchKeys();
  };

  const handleDelete = async (id: string) => {
    await api.delete(`/api/user/api-keys/${id}`);
    fetchKeys();
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Store your LLM provider API keys. Keys are encrypted at rest and never visible after saving.
        </p>
      </div>

      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const existing = keys.find((k) => k.provider === provider.id);
          const isAdding = addingProvider === provider.id;

          return (
            <div key={provider.id} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{provider.label}</span>
                </div>
                {existing ? (
                  <Badge variant="outline" className="text-xs">
                    <Check className="h-3 w-3 mr-1" />
                    Configured
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Not configured
                  </Badge>
                )}
              </div>

              {existing && !isAdding && (
                <div className="flex items-center justify-between">
                  <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                    {existing.keyPrefix}
                  </code>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAddingProvider(provider.id)}
                      className="text-xs h-7"
                    >
                      Replace
                    </Button>
                    <button
                      onClick={() => handleDelete(existing.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1"
                      title="Delete key"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {isAdding && (
                <div className="space-y-2">
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder={provider.placeholder}
                      className="pr-10 font-mono text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleSave(provider.id)}
                      disabled={saving || !newKey.trim()}
                    >
                      {saving ? "Saving..." : "Save Key"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingProvider(null);
                        setNewKey("");
                        setShowKey(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {!existing && !isAdding && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddingProvider(provider.id)}
                  className="text-xs"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Key
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
