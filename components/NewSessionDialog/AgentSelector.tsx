import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Check, Loader2, AlertCircle } from "lucide-react";
import type { AgentType } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers/registry";
import { useCliStatus, useInstallCli } from "@/data/cli-status";
import { AGENT_OPTIONS } from "./NewSessionDialog.types";

interface AgentSelectorProps {
  value: AgentType;
  onChange: (value: AgentType) => void;
}

export function AgentSelector({ value, onChange }: AgentSelectorProps) {
  const { data: cliStatus, isLoading: statusLoading } = useCliStatus();
  const installCli = useInstallCli();

  const selectedProvider = getProviderDefinition(value);
  const isInstalled = cliStatus?.[value]?.installed ?? true;
  const hasInstallCommand = !!selectedProvider.installCommand;

  const handleChange = (v: string) => {
    installCli.reset();
    onChange(v as AgentType);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Agent</label>
      <Select value={value} onValueChange={handleChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {AGENT_OPTIONS.map((option) => {
            const installed = cliStatus?.[option.value]?.installed;
            return (
              <SelectItem key={option.value} value={option.value}>
                <span className="font-medium">{option.label}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {option.description}
                </span>
                {!statusLoading && installed === false && (
                  <Badge
                    variant="outline"
                    className="ml-2 px-1.5 py-0 text-[10px]"
                  >
                    not installed
                  </Badge>
                )}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {!statusLoading && !isInstalled && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-sm">
          <AlertCircle className="h-4 w-4 shrink-0 text-yellow-500" />
          <span className="text-muted-foreground flex-1">
            {selectedProvider.name} is not installed.
          </span>
          {hasInstallCommand && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={installCli.isPending}
              onClick={() => installCli.mutate(value)}
            >
              {installCli.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="mr-1 h-3 w-3" />
                  Install
                </>
              )}
            </Button>
          )}
        </div>
      )}

      {installCli.isSuccess && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-400">
          <Check className="h-4 w-4 shrink-0" />
          {selectedProvider.name} installed successfully.
        </div>
      )}

      {installCli.isError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-400">
          Installation failed: {installCli.error?.message}
        </div>
      )}
    </div>
  );
}
