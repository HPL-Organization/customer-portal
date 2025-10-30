"use client";

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  TextField,
  Typography,
} from "@mui/material";
import { UserCog } from "lucide-react";

interface ProfileUpdateDialogProps {
  open: boolean;
  onClose: () => void;
  firstName: string;
  onFirstNameChange: (value: string) => void;
  middleName: string;
  onMiddleNameChange: (value: string) => void;
  lastName: string;
  onLastNameChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}

export function ProfileUpdateDialog({
  open,
  onClose,
  firstName,
  onFirstNameChange,
  middleName,
  onMiddleNameChange,
  lastName,
  onLastNameChange,
  onSave,
  saving,
}: ProfileUpdateDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="profile-update-dialog-title"
      PaperProps={{
        sx: {
          borderRadius: 3,
          width: 520,
          maxWidth: "90vw",
          boxShadow:
            "0 10px 30px rgba(2,6,23,0.25), 0 1px 0 rgba(2,6,23,0.05)",
        },
      }}
    >
      <DialogTitle id="profile-update-dialog-title" sx={{ pb: 1 }}>
        <Box className="flex items-center gap-3">
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: "9999px",
              backgroundColor: "#fef3c7",
              display: "grid",
              placeItems: "center",
            }}
          >
            <UserCog className="h-4 w-4" color="#d97706" />
          </Box>
          <Box>
            <Typography sx={{ fontWeight: 700, fontSize: 18 }}>
              Profile Update Required
            </Typography>
            <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
              To join the live session, please confirm your name.
            </Typography>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Box sx={{ display: "grid", gap: 1.5 }}>
          <TextField
            label="First name"
            size="small"
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
            inputProps={{ maxLength: 80 }}
          />
          <TextField
            label="Middle name (optional)"
            size="small"
            value={middleName}
            onChange={(e) => onMiddleNameChange(e.target.value)}
            inputProps={{ maxLength: 80 }}
          />
          <TextField
            label="Last name"
            size="small"
            value={lastName}
            onChange={(e) => onLastNameChange(e.target.value)}
            inputProps={{ maxLength: 80 }}
          />
          <Box className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                We&apos;ll save this to your account and won&apos;t ask again.
              </Typography>
          </Box>
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2, gap: 1.5 }}>
        <Button
          variant="outlined"
          onClick={onClose}
          disabled={saving}
          sx={{
            textTransform: "none",
            borderColor: "#d1d5db",
            color: "#6b7280",
            "&:hover": { borderColor: "#9ca3af", backgroundColor: "#f9fafb" },
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={onSave}
          disabled={saving}
          sx={{
            textTransform: "none",
            backgroundColor: "#17152A",
            "&:hover": { backgroundColor: "#8C0F0F" },
          }}
        >
          {saving ? "Saving…" : "Save & Join"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
