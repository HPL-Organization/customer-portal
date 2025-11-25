"use client";

import {
  Box,
  Button,
  Chip,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

type InvoiceMode = "rolling" | "fixed";

interface PayBeforePlayProps {
  state: {
    enabled: boolean;
    mode: InvoiceMode;
    fromDate: string | null;
    toDate: string | null;
    dirty: boolean;
    saving: boolean;
    error: string | null;
  };
  disableSave: boolean;
  presetOptions: { key: string; label: string }[];
  activePresetKey: string;
  onToggle(enabled: boolean): void;
  onModeChange(mode: InvoiceMode): void;
  onDateChange(field: "fromDate" | "toDate", value: string): void;
  onPresetChange(key: string): void;
  onSave(): void;
}

export default function PayBeforePlay({
  state,
  disableSave,
  presetOptions,
  activePresetKey,
  onToggle,
  onModeChange,
  onDateChange,
  onPresetChange,
  onSave,
}: PayBeforePlayProps) {
  const presetValue = state.enabled ? activePresetKey : "custom";

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: "1px solid",
        borderColor: "divider",
        px: 1.5,
        py: 1.25,
        backgroundColor: state.enabled
          ? "rgba(34,197,94,0.04)"
          : "background.paper",
        minWidth: 320,
      }}
    >
      {/* Header: VIP chip + label + switch */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: state.enabled ? 1 : 0,
          gap: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip
            size="small"
            label="VIP"
            color={state.enabled ? "success" : "default"}
            variant={state.enabled ? "filled" : "outlined"}
          />
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            <Typography variant="subtitle2">Pay Before Play</Typography>
            <Typography variant="caption" color="text.secondary">
              Control VIP invoice window
            </Typography>
          </Box>
        </Box>

        <Switch
          checked={state.enabled}
          onChange={(_, checked) => onToggle(checked)}
          size="small"
          disabled={state.saving}
        />
      </Box>

      {state.enabled && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
          {/* Mode + Preset row */}
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            <TextField
              select
              label="Window type"
              size="small"
              value={state.mode}
              onChange={(e) =>
                onModeChange(e.target.value as "rolling" | "fixed")
              }
              disabled={state.saving}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="rolling">Rolling window</MenuItem>
              <MenuItem value="fixed">Fixed dates</MenuItem>
            </TextField>

            <TextField
              select
              label="Preset"
              size="small"
              value={presetValue}
              onChange={(e) => onPresetChange(e.target.value)}
              disabled={state.saving}
              sx={{ minWidth: 170 }}
            >
              <MenuItem value="custom">Custom dates</MenuItem>
              {presetOptions.map((preset) => (
                <MenuItem key={preset.key} value={preset.key}>
                  {preset.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          {/* Date row */}
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
            }}
          >
            <TextField
              label="From"
              type="date"
              size="small"
              value={state.fromDate ?? ""}
              onChange={(e) => onDateChange("fromDate", e.target.value)}
              disabled={state.saving}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label="To"
              type="date"
              size="small"
              value={state.toDate ?? ""}
              onChange={(e) => onDateChange("toDate", e.target.value)}
              disabled={state.saving}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            />
          </Box>

          {state.error && (
            <Typography variant="caption" color="error">
              {state.error}
            </Typography>
          )}
        </Box>
      )}

      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          mt: state.enabled ? 1.5 : 0.75,
        }}
      >
        <Button
          variant={state.enabled ? "contained" : "outlined"}
          size="small"
          onClick={onSave}
          disabled={disableSave}
        >
          {state.saving
            ? "Saving..."
            : state.enabled
            ? "Save"
            : "Save (turn off)"}
        </Button>
      </Box>
    </Box>
  );
}
