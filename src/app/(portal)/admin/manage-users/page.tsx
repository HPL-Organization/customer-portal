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
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
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
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";
import { useDebouncedCallback } from "use-debounce";
import { deleteUser, fetchUsers, type PaginatedUsersResult } from "./actions";

interface User {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  profile?: {
    netsuite_customer_id?: string;
    role?: string;
    email?: string;
  } | null;
}

const DEFAULT_ROWS_PER_PAGE = 10;

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

  // Ref for search input
  const searchInputRef = useRef<HTMLInputElement>(null);


  const loadUsers = useCallback(async (currentPage: number = page, currentRowsPerPage: number = rowsPerPage, search?: string) => {
    try {
      setLoading(true);
      const result: PaginatedUsersResult = await fetchUsers(currentPage + 1, currentRowsPerPage, search); // Convert 0-based to 1-based
      setUsers(result.users);
      setTotalCount(result.totalCount);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          credentials: 'include',
        });
        const data = await response.json();
        setIsAdmin(data.isAdmin || false);
      } catch (error) {
        console.error('Error checking admin status:', error);
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
      toast.success(result.message || `User ${userToDelete.email || 'unknown'} deleted successfully`);
      // Reload users to update pagination if necessary
      await loadUsers(page, rowsPerPage, searchTerm);
      setDeleteDialogOpen(false);
      setUserToDelete(null);
    } catch (error) {
      console.error('Error deleting user:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete user');
    }
  };

  const handlePageChange = (event: unknown, newPage: number) => {
    setPage(newPage);
    loadUsers(newPage, rowsPerPage, searchTerm);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newRowsPerPage = parseInt(event.target.value, 10);
    setRowsPerPage(newRowsPerPage);
    setPage(0); // Reset to first page
    loadUsers(0, newRowsPerPage, searchTerm);
  };

  // Create debounced search function
  const debouncedSearch = useDebouncedCallback(
    (searchValue: string) => {
      loadUsers(0, rowsPerPage, searchValue);
    },
    300
  );

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setPage(0); // Reset to first page when searching
    debouncedSearch(value);
  };

  // Since we're doing server-side filtering, users are already filtered
  const filteredUsers = users;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getUserDisplayName = (user: User): string => {
    const firstName = typeof user.user_metadata?.first_name === 'string' ? user.user_metadata.first_name : '';
    const lastName = typeof user.user_metadata?.last_name === 'string' ? user.user_metadata.last_name : '';

    if (firstName || lastName) {
      return `${firstName} ${lastName}`.trim();
    }

    // Fallback to legacy fields
    return (typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : undefined) ||
           (typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : undefined) ||
           (typeof user.user_metadata?.display_name === 'string' ? user.user_metadata.display_name : undefined) ||
           user.email?.split('@')[0] ||
           'Unknown User';
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
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4">
          Manage Users
        </Typography>
        <Button
          variant="outlined"
          startIcon={<User />}
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
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredUsers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        {users.length === 0 ? 'No users found' : 'No users match your search'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user) => (
                    <TableRow key={user.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <User size={16} />
                          {typeof user.user_metadata?.first_name === 'string' ? user.user_metadata.first_name : '—'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {typeof user.user_metadata?.last_name === 'string' ? user.user_metadata.last_name : '—'}
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Mail size={16} />
                          {user.email || 'No email'}
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Calendar size={16} />
                          {formatDate(user.created_at)}
                        </Box>
                      </TableCell>
                      <TableCell>
                        {user.last_sign_in_at ? formatDate(user.last_sign_in_at) : 'Never'}
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
                <Typography>Email: {selectedUser.email || 'No email'}</Typography>
                {typeof selectedUser.user_metadata?.first_name === 'string' && (
                  <Typography>First Name: {selectedUser.user_metadata.first_name}</Typography>
                )}
                {typeof selectedUser.user_metadata?.last_name === 'string' && (
                  <Typography>Last Name: {selectedUser.user_metadata.last_name}</Typography>
                )}
              </Box>

              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Account Information
                </Typography>
                <Typography>Created: {formatDate(selectedUser.created_at)}</Typography>
                <Typography>
                  Last Sign In: {selectedUser.last_sign_in_at ? formatDate(selectedUser.last_sign_in_at) : 'Never'}
                </Typography>
                {typeof selectedUser.app_metadata?.role === 'string' && (
                  <Typography>Role: {selectedUser.app_metadata.role}</Typography>
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
            Are you sure you want to delete the user &quot;{userToDelete?.email}&quot;?
            This action cannot be undone.
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
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i} hover style={{ backgroundColor: i % 2 === 0 ? '#f9fafb' : '#ffffff' }}>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Skeleton variant="circular" width={16} height={16} />
                  <Skeleton width={120} />
                </Box>
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Skeleton variant="circular" width={16} height={16} />
                  <Skeleton width={180} />
                </Box>
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Skeleton variant="circular" width={16} height={16} />
                  <Skeleton width={80} />
                </Box>
              </TableCell>
              <TableCell>
                <Skeleton width={80} />
              </TableCell>
              <TableCell>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Skeleton variant="rectangular" width={32} height={32} sx={{ borderRadius: 1 }} />
                  <Skeleton variant="rectangular" width={32} height={32} sx={{ borderRadius: 1 }} />
                </Box>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
