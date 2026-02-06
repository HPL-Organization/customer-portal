"use client";

import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  TableSortLabel,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";

type UserStatRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  created_at: string;
  total_revenue?: number;
};

type UserStatResponse = {
  users: UserStatRow[];
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
  totalRevenue: number;
};

export default function UserStatisticsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserStatRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [sortBy, setSortBy] = useState<
    "email" | "first_name" | "last_name" | "created_at" | "total_revenue"
  >("email");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
        });
        const data = await response.json();
        setIsAdmin(data.isAdmin || false);
      } catch (err) {
        console.error("Error checking admin status:", err);
        setIsAdmin(false);
      }
    };

    checkAdminStatus();
  }, []);

  useEffect(() => {
    if (!isAdmin) return;

    const loadUsers = async () => {
      try {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams();
        params.set("page", String(page + 1));
        params.set("limit", String(rowsPerPage));
        if (appliedFrom) params.set("from", appliedFrom);
        if (appliedTo) params.set("to", appliedTo);
        params.set("sortBy", sortBy);
        params.set("sortDir", sortDir);

        const response = await fetch(
          `/api/admin/user-statistics?${params.toString()}`,
          {
            method: "GET",
            credentials: "include",
          }
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || "Failed to load users");
        }

        const data = (await response.json()) as UserStatResponse;
        setUsers(data.users || []);
        setTotalCount(data.totalCount || 0);
        setTotalRevenue(data.totalRevenue || 0);
      } catch (err) {
        console.error("Error loading user statistics:", err);
        setError(err instanceof Error ? err.message : "Failed to load users");
      } finally {
        setLoading(false);
      }
    };

    loadUsers();
  }, [isAdmin, page, rowsPerPage, appliedFrom, appliedTo, sortBy, sortDir]);

  const handlePageChange = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const next = parseInt(event.target.value, 10);
    setRowsPerPage(next);
    setPage(0);
  };

  const handleApplyFilter = () => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    setPage(0);
  };

  const handleClearFilter = () => {
    setFromDate("");
    setToDate("");
    setAppliedFrom("");
    setAppliedTo("");
    setPage(0);
  };

  const handleRequestSort = (
    column:
      | "email"
      | "first_name"
      | "last_name"
      | "created_at"
      | "total_revenue"
  ) => {
    if (sortBy === column) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(column);
    setSortDir("asc");
  };

  const getSortDirection = (column: string) =>
    sortBy === column ? sortDir : false;

  const formatCreatedAt = (value: string) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString();
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleExportCsv = async () => {
    try {
      const params = new URLSearchParams();
      if (appliedFrom) params.set("from", appliedFrom);
      if (appliedTo) params.set("to", appliedTo);
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      params.set("export", "csv");

      const response = await fetch(
        `/api/admin/user-statistics?${params.toString()}`,
        {
          method: "GET",
          credentials: "include",
        }
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to export CSV");
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition");
      const match = contentDisposition?.match(/filename="([^"]+)"/);
      const filename = match?.[1] || "user_statistics.csv";

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export failed:", err);
      setError(err instanceof Error ? err.message : "Failed to export CSV");
    }
  };

  if (isAdmin === null) {
    return (
      <Box sx={{ padding: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isAdmin === false) {
    return (
      <Box sx={{ padding: 4 }}>
        <Typography variant="h6" color="error">
          You don&apos;t have permission to access user statistics.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ padding: 4, maxWidth: 960, margin: "0 auto" }}>
      <Card>
        <CardContent>
          <Typography variant="h5" gutterBottom>
            User Statistics
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Users from the Supabase auth table.
          </Typography>

          <Box
            sx={{
              display: "flex",
              gap: 2,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 2,
            }}
          >
            <TextField
              type="date"
              label="From"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <TextField
              type="date"
              label="To"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
            />
            <Button variant="contained" onClick={handleApplyFilter}>
              Apply
            </Button>
            <Button variant="text" onClick={handleClearFilter}>
              Clear
            </Button>
            <Button variant="outlined" onClick={handleExportCsv}>
              Export CSV
            </Button>
          </Box>

          {loading && (
            <Box sx={{ display: "flex", justifyContent: "center", padding: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {error && (
            <Typography color="error" sx={{ marginBottom: 2 }}>
              {error}
            </Typography>
          )}

          {!loading && !error && (
            <Typography variant="subtitle1" sx={{ marginBottom: 2 }}>
              Total revenue (amount paid): {formatCurrency(totalRevenue)}
            </Typography>
          )}

          {!loading && !error && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sortDirection={getSortDirection("email")}>
                      <TableSortLabel
                        active={sortBy === "email"}
                        direction={sortBy === "email" ? sortDir : "asc"}
                        onClick={() => handleRequestSort("email")}
                      >
                        Email
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={getSortDirection("first_name")}>
                      <TableSortLabel
                        active={sortBy === "first_name"}
                        direction={sortBy === "first_name" ? sortDir : "asc"}
                        onClick={() => handleRequestSort("first_name")}
                      >
                        First name
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={getSortDirection("last_name")}>
                      <TableSortLabel
                        active={sortBy === "last_name"}
                        direction={sortBy === "last_name" ? sortDir : "asc"}
                        onClick={() => handleRequestSort("last_name")}
                      >
                        Last name
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={getSortDirection("total_revenue")}>
                      <TableSortLabel
                        active={sortBy === "total_revenue"}
                        direction={sortBy === "total_revenue" ? sortDir : "asc"}
                        onClick={() => handleRequestSort("total_revenue")}
                      >
                        <Box
                          component="span"
                          sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "flex-start",
                          }}
                        >
                          <span>Total revenue</span>
                          <Typography variant="caption" color="text.secondary">
                            Not filtered by date range
                          </Typography>
                        </Box>
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sortDirection={getSortDirection("created_at")}>
                      <TableSortLabel
                        active={sortBy === "created_at"}
                        direction={sortBy === "created_at" ? sortDir : "asc"}
                        onClick={() => handleRequestSort("created_at")}
                      >
                        Created at
                      </TableSortLabel>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {users.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          No users found.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    users.map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.email || "-"}</TableCell>
                        <TableCell>{user.first_name || "-"}</TableCell>
                        <TableCell>{user.last_name || "-"}</TableCell>
                        <TableCell>
                          {formatCurrency(user.total_revenue ?? 0)}
                        </TableCell>
                        <TableCell>{formatCreatedAt(user.created_at)}</TableCell>
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
          />
        </CardContent>
      </Card>
    </Box>
  );
}
