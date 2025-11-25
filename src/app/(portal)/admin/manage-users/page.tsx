"use client";

import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  Calendar,
  Eye,
  Mail,
  Search,
  Shield,
  Trash2,
  User as UserIcon,
} from "lucide-react";
import PayBeforePlay from "@/components/UI/PayBeforePlay";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useDebouncedCallback } from "use-debounce";
import {
  deleteUser,
  fetchUsers,
  applyGlobalInvoiceSettings,
  upsertCustomerInvoiceSettings,
  type InvoiceDateParts,
  type InvoiceRange,
  type PaginatedUsersResult,
  type User,
} from "./actions";

const DEFAULT_ROWS_PER_PAGE = 10;

interface InvoiceUIState {
  enabled: boolean;
  mode: "rolling" | "fixed";
  fromDate: string | null;
  toDate: string | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

type InvoiceStateMap = Record<string, InvoiceUIState>;

type PresetRangeConfig = {
  key: string;
  label: string;
  days?: number;
  months?: number;
};

const PRESET_RANGES: PresetRangeConfig[] = [
  { key: "last_7_days", label: "Last 7 days", days: 7 },
  { key: "last_15_days", label: "Last 15 days", days: 15 },
  { key: "last_1_month", label: "Last 1 month", months: 1 },
  { key: "last_3_months", label: "Last 3 months", months: 3 },
];

const pad = (value: number) => value.toString().padStart(2, "0");

const partsToIso = (parts?: InvoiceDateParts | null): string | null => {
  if (!parts) return null;
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

const isoToParts = (value: string | null): InvoiceDateParts | null => {
  if (!value) return null;
  const [year, month, day] = value.split("-").map((segment) => Number(segment));
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }

  return { year, month, day };
};

const buildRangePayload = (
  from: string | null,
  to: string | null,
  mode: "rolling" | "fixed"
): InvoiceRange | null => {
  const fromParts = isoToParts(from);
  const toParts = isoToParts(to);

  if (!fromParts && !toParts) {
    return null;
  }

  return {
    mode,
    from: fromParts ?? undefined,
    to: toParts ?? undefined,
  };
};

const addDays = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
};

const addMonths = (date: Date, amount: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + amount);
  return next;
};

const formatDateInput = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}`;
};

const getDefaultRangeDates = () => {
  const today = new Date();
  const from = addDays(today, -6); // last 7 days inclusive
  return {
    from: formatDateInput(from),
    to: formatDateInput(today),
  };
};
const getPresetKeyForState = (state: InvoiceUIState): string => {
  if (!state.fromDate || !state.toDate) return "custom";

  for (const preset of PRESET_RANGES) {
    const { from, to } = computePresetRange(preset);
    if (state.fromDate === from && state.toDate === to) {
      return preset.key;
    }
  }

  return "custom";
};

const computePresetRange = (preset: PresetRangeConfig) => {
  const today = new Date();
  let from = new Date(today);

  if (preset.days) {
    from = addDays(today, -(preset.days - 1));
  } else if (preset.months) {
    from = addMonths(today, -preset.months);
  }

  return {
    from: formatDateInput(from),
    to: formatDateInput(today),
  };
};

const createEmptyInvoiceState = (): InvoiceUIState => ({
  enabled: false,
  mode: "rolling",
  fromDate: null,
  toDate: null,
  dirty: false,
  saving: false,
  error: null,
});

const createInvoiceStateFromUser = (user: User): InvoiceUIState => {
  const range = user.invoiceSettings?.range;

  let mode: "rolling" | "fixed" = "rolling";

  if (range && (range.mode === "rolling" || range.mode === "fixed")) {
    mode = range.mode;
  } else if (range && (range.from || range.to)) {
    mode = "fixed";
  }

  return {
    enabled: !!user.invoiceSettings?.checkInvoice,
    mode,
    fromDate: partsToIso(range?.from ?? null),
    toDate: partsToIso(range?.to ?? null),
    dirty: false,
    saving: false,
    error: null,
  };
};

const validateInvoiceState = (state: InvoiceUIState): string | null => {
  if (!state.enabled) {
    return null;
  }

  if (!state.fromDate || !state.toDate) {
    return "Please select both From and To dates.";
  }

  if (new Date(state.fromDate) > new Date(state.toDate)) {
    return "'From' date cannot be after 'To' date.";
  }

  return null;
};

export default function ManageUsersPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

  // Pagination state
  const [page, setPage] = useState(0); // MUI TablePagination uses 0-based indexing
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const [totalCount, setTotalCount] = useState(0);
  const [invoiceStates, setInvoiceStates] = useState<InvoiceStateMap>({});
  const [globalInvoiceState, setGlobalInvoiceState] = useState<InvoiceUIState>(
    () => createEmptyInvoiceState()
  );

  // Ref for search input
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadUsers = useCallback(
    async (
      currentPage: number = page,
      currentRowsPerPage: number = rowsPerPage,
      search?: string
    ) => {
      try {
        setLoading(true);
        const result: PaginatedUsersResult = await fetchUsers(
          currentPage + 1,
          currentRowsPerPage,
          search
        ); // Convert 0-based to 1-based
        setUsers(result.users);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error("Error fetching users:", error);
        toast.error(
          error instanceof Error ? error.message : "Failed to fetch users"
        );
      } finally {
        setLoading(false);
      }
    },
    [page, rowsPerPage]
  );

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();
        setIsAdmin(data.isAdmin || false);
      } catch (error) {
        console.error("Error checking admin status:", error);
        setIsAdmin(false);
      }
    };

    checkAdminStatus();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
    }
  }, [isAdmin, loadUsers]);

  // Focus search input after loading completes when searching
  useEffect(() => {
    if (!loading && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [loading, searchTerm]);

  useEffect(() => {
    if (!users.length) {
      setInvoiceStates({});
      return;
    }

    const mapped = users.reduce<InvoiceStateMap>((acc, user) => {
      acc[user.id] = createInvoiceStateFromUser(user);
      return acc;
    }, {});

    setInvoiceStates(mapped);
  }, [users]);

  const handleViewUser = (user: User) => {
    setSelectedUser(user);
  };

  const handleDeleteUser = (user: User) => {
    setUserToDelete(user);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      const result = await deleteUser(userToDelete.id);
      toast.success(
        result.message ||
          `User ${userToDelete.email || "unknown"} deleted successfully`
      );
      // Reload users to update pagination if necessary
      await loadUsers(page, rowsPerPage, searchTerm);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (error) {
      console.error("Error deleting user:", error);
      toast.error(
        error instanceof Error ? error.message : "Failed to delete user"
      );
    }
  };

  const handlePageChange = (event: unknown, newPage: number) => {
    setPage(newPage);
    loadUsers(newPage, rowsPerPage, searchTerm);
  };

  const handleRowsPerPageChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const newRowsPerPage = parseInt(event.target.value, 10);
    setRowsPerPage(newRowsPerPage);
    setPage(0); // Reset to first page
    loadUsers(0, newRowsPerPage, searchTerm);
  };

  // Create debounced search function
  const debouncedSearch = useDebouncedCallback((searchValue: string) => {
    loadUsers(0, rowsPerPage, searchValue);
  }, 300);

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setPage(0); // Reset to first page when searching
    debouncedSearch(value);
  };

  // Since we're doing server-side filtering, users are already filtered
  const filteredUsers = users;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getUserDisplayName = (user: User): string => {
    const firstName =
      typeof user.user_metadata?.first_name === "string"
        ? user.user_metadata.first_name
        : "";
    const lastName =
      typeof user.user_metadata?.last_name === "string"
        ? user.user_metadata.last_name
        : "";

    if (firstName || lastName) {
      return `${firstName} ${lastName}`.trim();
    }

    // Fallback to legacy fields
    return (
      (typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : undefined) ||
      (typeof user.user_metadata?.name === "string"
        ? user.user_metadata.name
        : undefined) ||
      (typeof user.user_metadata?.display_name === "string"
        ? user.user_metadata.display_name
        : undefined) ||
      user.email?.split("@")[0] ||
      "Unknown User"
    );
  };

  const handleToggleInvoice = (userId: string, enabled: boolean) => {
    setInvoiceStates((prev) => {
      const current = prev[userId] ?? createEmptyInvoiceState();
      let nextFrom = current.fromDate;
      let nextTo = current.toDate;

      if (enabled && (!nextFrom || !nextTo)) {
        const defaults = getDefaultRangeDates();
        nextFrom = defaults.from;
        nextTo = defaults.to;
      }

      return {
        ...prev,
        [userId]: {
          ...current,
          enabled,
          fromDate: nextFrom,
          toDate: nextTo,
          dirty: true,
          error: null,
        },
      };
    });
  };

  const handleDateChange = (
    userId: string,
    key: "fromDate" | "toDate",
    value: string
  ) => {
    setInvoiceStates((prev) => {
      const current = prev[userId] ?? createEmptyInvoiceState();
      return {
        ...prev,
        [userId]: {
          ...current,
          [key]: value || null,
          dirty: true,
          error: null,
        },
      };
    });
  };
  const handleModeChange = (userId: string, mode: "rolling" | "fixed") => {
    setInvoiceStates((prev) => {
      const current = prev[userId] ?? createEmptyInvoiceState();

      let fromDate = current.fromDate;
      let toDate = current.toDate;

      // If switching to rolling with no dates, seed with default last-7-days
      if (mode === "rolling" && (!fromDate || !toDate)) {
        const defaults = getDefaultRangeDates();
        fromDate = defaults.from;
        toDate = defaults.to;
      }

      return {
        ...prev,
        [userId]: {
          ...current,
          mode,
          fromDate,
          toDate,
          dirty: true,
          error: null,
        },
      };
    });
  };

  const handlePresetSelect = (userId: string, presetKey: string) => {
    const preset = PRESET_RANGES.find((p) => p.key === presetKey);
    if (!preset) return;

    const range = computePresetRange(preset);

    setInvoiceStates((prev) => {
      const current = prev[userId] ?? createEmptyInvoiceState();
      return {
        ...prev,
        [userId]: {
          ...current,
          enabled: true,
          fromDate: range.from,
          toDate: range.to,
          dirty: true,
          error: null,
        },
      };
    });
  };

  const handleSaveInvoiceSettings = async (user: User) => {
    const state = invoiceStates[user.id] ?? createEmptyInvoiceState();

    if (state.saving || !state.dirty) {
      return;
    }

    const validationError = validateInvoiceState(state);
    if (validationError) {
      toast.error(validationError);
      setInvoiceStates((prev) => ({
        ...prev,
        [user.id]: {
          ...(prev[user.id] ?? createEmptyInvoiceState()),
          error: validationError,
        },
      }));
      return;
    }

    setInvoiceStates((prev) => ({
      ...prev,
      [user.id]: {
        ...(prev[user.id] ?? createEmptyInvoiceState()),
        saving: true,
        error: null,
      },
    }));

    try {
      await upsertCustomerInvoiceSettings({
        userId: user.id,
        netsuiteCustomerId: user.profile?.netsuite_customer_id ?? null,
        checkInvoice: state.enabled,
        range: state.enabled
          ? buildRangePayload(state.fromDate, state.toDate, state.mode)
          : null,
      });
      toast.success("Pay Before Play updated");
      setInvoiceStates((prev) => ({
        ...prev,
        [user.id]: {
          ...(prev[user.id] ?? createEmptyInvoiceState()),
          enabled: state.enabled,
          fromDate: state.fromDate,
          toDate: state.toDate,
          dirty: false,
          saving: false,
          error: null,
        },
      }));
    } catch (error) {
      console.error("Error updating Pay Before Play:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update Pay Before Play"
      );
      setInvoiceStates((prev) => ({
        ...prev,
        [user.id]: {
          ...(prev[user.id] ?? createEmptyInvoiceState()),
          saving: false,
        },
      }));
    }
  };
  const handleGlobalToggleInvoice = (enabled: boolean) => {
    setGlobalInvoiceState((prev) => {
      let fromDate = prev.fromDate;
      let toDate = prev.toDate;

      if (enabled && (!fromDate || !toDate)) {
        const defaults = getDefaultRangeDates();
        fromDate = defaults.from;
        toDate = defaults.to;
      }

      return {
        ...prev,
        enabled,
        fromDate,
        toDate,
        dirty: true,
        error: null,
      };
    });
  };

  const handleGlobalModeChange = (mode: "rolling" | "fixed") => {
    setGlobalInvoiceState((prev) => {
      let fromDate = prev.fromDate;
      let toDate = prev.toDate;

      if (mode === "rolling" && (!fromDate || !toDate)) {
        const defaults = getDefaultRangeDates();
        fromDate = defaults.from;
        toDate = defaults.to;
      }

      return {
        ...prev,
        mode,
        fromDate,
        toDate,
        dirty: true,
        error: null,
      };
    });
  };

  const handleGlobalDateChange = (
    field: "fromDate" | "toDate",
    value: string
  ) => {
    setGlobalInvoiceState((prev) => ({
      ...prev,
      [field]: value || null,
      dirty: true,
      error: null,
    }));
  };

  const handleGlobalPresetChange = (key: string) => {
    setGlobalInvoiceState((prev) => {
      if (key === "custom") {
        return {
          ...prev,
          dirty: true,
          error: null,
        };
      }

      const preset = PRESET_RANGES.find((p) => p.key === key);
      if (!preset) return prev;

      const range = computePresetRange(preset);

      return {
        ...prev,
        enabled: true,
        fromDate: range.from,
        toDate: range.to,
        dirty: true,
        error: null,
      };
    });
  };

  const handleGlobalSave = async () => {
    const state = globalInvoiceState;

    if (state.saving || !state.dirty) {
      return;
    }

    const validationError = validateInvoiceState(state);
    if (validationError) {
      toast.error(validationError);
      setGlobalInvoiceState((prev) => ({
        ...prev,
        error: validationError,
      }));
      return;
    }

    setGlobalInvoiceState((prev) => ({
      ...prev,
      saving: true,
      error: null,
    }));

    try {
      const range =
        state.enabled && state.fromDate && state.toDate
          ? buildRangePayload(state.fromDate, state.toDate, state.mode)
          : null;

      const result = await applyGlobalInvoiceSettings({
        checkInvoice: state.enabled,
        range,
      });

      toast.success(
        `Global Pay Before Play updated for ${result.updated} customers`
      );

      setGlobalInvoiceState((prev) => ({
        ...prev,
        dirty: false,
        saving: false,
        error: null,
      }));

      await loadUsers(page, rowsPerPage, searchTerm);
    } catch (error) {
      console.error("Error applying global Pay Before Play:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to apply global Pay Before Play"
      );

      setGlobalInvoiceState((prev) => ({
        ...prev,
        saving: false,
      }));
    }
  };

  if (!isAdmin) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        minHeight="400px"
        textAlign="center"
      >
        <Shield size={64} color="#9ca3af" />
        <Typography variant="h4" sx={{ mt: 2, mb: 1 }}>
          Access Denied
        </Typography>
        <Typography variant="body1" color="text.secondary">
          You don&apos;t have permission to access user management.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box
        sx={{
          mb: 3,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography variant="h4">Manage Users</Typography>
        <Button
          variant="outlined"
          startIcon={<UserIcon />}
          onClick={() => loadUsers(page, rowsPerPage, searchTerm)}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <TextField
            fullWidth
            placeholder="Search users by name or email..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            disabled={loading}
            inputRef={searchInputRef}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={20} />
                </InputAdornment>
              ),
            }}
          />
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            Global Pay Before Play
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Apply a Pay Before Play window to all users on this page. Individual
            changes below will override this.
          </Typography>
          {(() => {
            const globalDisableSave =
              globalInvoiceState.saving ||
              !globalInvoiceState.dirty ||
              (globalInvoiceState.enabled &&
                (!globalInvoiceState.fromDate || !globalInvoiceState.toDate));

            const globalPresetKey = getPresetKeyForState(globalInvoiceState);

            return (
              <PayBeforePlay
                state={globalInvoiceState}
                disableSave={globalDisableSave}
                presetOptions={PRESET_RANGES.map(({ key, label }) => ({
                  key,
                  label,
                }))}
                activePresetKey={globalPresetKey}
                onToggle={handleGlobalToggleInvoice}
                onModeChange={handleGlobalModeChange}
                onDateChange={(field, value) =>
                  handleGlobalDateChange(field, value)
                }
                onPresetChange={handleGlobalPresetChange}
                onSave={handleGlobalSave}
              />
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        {loading ? (
          <SkeletonTable />
        ) : (
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>First Name</TableCell>
                  <TableCell>Last Name</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell>Last Sign In</TableCell>
                  <TableCell>Pay Before Play</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        {users.length === 0
                          ? "No users found"
                          : "No users match your search"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id} hover>
                      <TableCell>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <UserIcon size={16} />
                          {typeof user.user_metadata?.first_name === "string"
                            ? user.user_metadata.first_name
                            : "—"}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {typeof user.user_metadata?.last_name === "string"
                          ? user.user_metadata.last_name
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Mail size={16} />
                          {user.email || "No email"}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Calendar size={16} />
                          {formatDate(user.created_at)}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {user.last_sign_in_at
                          ? formatDate(user.last_sign_in_at)
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const state =
                            invoiceStates[user.id] ?? createEmptyInvoiceState();
                          const disableSave =
                            state.saving ||
                            !state.dirty ||
                            (state.enabled &&
                              (!state.fromDate || !state.toDate));

                          const activePresetKey = getPresetKeyForState(state);

                          return (
                            <PayBeforePlay
                              state={state}
                              disableSave={disableSave}
                              presetOptions={PRESET_RANGES.map(
                                ({ key, label }) => ({
                                  key,
                                  label,
                                })
                              )}
                              activePresetKey={activePresetKey}
                              onToggle={(enabled) =>
                                handleToggleInvoice(user.id, enabled)
                              }
                              onModeChange={(mode) =>
                                handleModeChange(user.id, mode)
                              }
                              onDateChange={(field, value) =>
                                handleDateChange(user.id, field, value)
                              }
                              onPresetChange={(key) => {
                                if (key === "custom") {
                                  setInvoiceStates((prev) => {
                                    const current =
                                      prev[user.id] ??
                                      createEmptyInvoiceState();
                                    return {
                                      ...prev,
                                      [user.id]: {
                                        ...current,
                                        dirty: true,
                                        error: null,
                                      },
                                    };
                                  });
                                } else {
                                  handlePresetSelect(user.id, key);
                                }
                              }}
                              onSave={() => handleSaveInvoiceSettings(user)}
                            />
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <IconButton
                          size="small"
                          onClick={() => handleViewUser(user)}
                          title="View Details"
                          disabled={loading}
                        >
                          <Eye size={16} />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteUser(user)}
                          title="Delete User"
                          disabled={loading}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <TablePagination
          component="div"
          count={totalCount}
          page={page}
          onPageChange={handlePageChange}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleRowsPerPageChange}
          rowsPerPageOptions={[10, 25, 50, 100]}
          disabled={loading}
        />
      </Card>

      {/* User Details Dialog */}
      <Dialog
        open={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>User Details</DialogTitle>
        <DialogContent>
          {selectedUser && (
            <Box sx={{ pt: 1 }}>
              <Typography variant="h6" gutterBottom>
                {getUserDisplayName(selectedUser)}
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                ID: {selectedUser.id}
              </Typography>

              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Contact Information
                </Typography>
                <Typography>
                  Email: {selectedUser.email || "No email"}
                </Typography>
                {typeof selectedUser.user_metadata?.first_name === "string" && (
                  <Typography>
                    First Name: {selectedUser.user_metadata.first_name}
                  </Typography>
                )}
                {typeof selectedUser.user_metadata?.last_name === "string" && (
                  <Typography>
                    Last Name: {selectedUser.user_metadata.last_name}
                  </Typography>
                )}
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Account Information
                </Typography>
                <Typography>
                  Created: {formatDate(selectedUser.created_at)}
                </Typography>
                <Typography>
                  Last Sign In:{" "}
                  {selectedUser.last_sign_in_at
                    ? formatDate(selectedUser.last_sign_in_at)
                    : "Never"}
                </Typography>
                {typeof selectedUser.app_metadata?.role === "string" && (
                  <Typography>
                    Role: {selectedUser.app_metadata.role}
                  </Typography>
                )}
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedUser(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the user &quot;{userToDelete?.email}
            &quot;? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={confirmDeleteUser} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function SkeletonTable() {
  return (
    <TableContainer component={Paper}>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Email</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Last Sign In</TableCell>
            <TableCell>Pay Before Play</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow
              key={i}
              hover
              style={{ backgroundColor: i % 2 === 0 ? "#f9fafb" : "#ffffff" }}
            >
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Skeleton variant="circular" width={16} height={16} />
                  <Skeleton width={120} />
                </Box>
              </TableCell>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Skeleton variant="circular" width={16} height={16} />
                  <Skeleton width={180} />
                </Box>
              </TableCell>
              <TableCell>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Skeleton variant="circular" width={16} height={16} />
                  <Skeleton width={80} />
                </Box>
              </TableCell>
              <TableCell>
                <Skeleton width={80} />
              </TableCell>
              <TableCell>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <Skeleton width={140} height={28} />
                  <Skeleton width={200} height={20} />
                </Box>
              </TableCell>
              <TableCell>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Skeleton
                    variant="rectangular"
                    width={32}
                    height={32}
                    sx={{ borderRadius: 1 }}
                  />
                  <Skeleton
                    variant="rectangular"
                    width={32}
                    height={32}
                    sx={{ borderRadius: 1 }}
                  />
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
