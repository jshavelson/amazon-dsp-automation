import React, { useState, useMemo, useCallback } from 'react';
import clsx from 'clsx';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Filter,
  Settings,
  RefreshCw,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDataRefresh } from '@/hooks/useDataRefresh';

interface Column<T> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  width?: string;
  className?: string;
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
  align?: 'left' | 'center' | 'right';
}

interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor?: (item: T) => string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (item: T) => void;
  selectedRows?: string[];
  onSelectRow?: (id: string) => void;
  onSelectAll?: () => void;
  isLoading?: boolean;
  emptyMessage?: string;
  className?: string;
  showHeader?: boolean;
  showFooter?: boolean;
  footerContent?: React.ReactNode;
  actions?: React.ReactNode;
  searchable?: boolean;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
  filterable?: boolean;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    pageSize?: number;
    totalItems?: number;
    pageSizeOptions?: number[];
  };
}

function Table<T>({
  columns,
  data,
  keyExtractor = (item: T) => (item as unknown as { id: string }).id,
  sortBy,
  sortOrder = 'asc',
  onSort,
  onRowClick,
  selectedRows = [],
  onSelectRow,
  onSelectAll,
  isLoading = false,
  emptyMessage = 'No data available',
  className,
  showHeader = true,
  showFooter = false,
  footerContent,
  actions,
  searchable = false,
  onSearch,
  searchPlaceholder = 'Search...',
  filterable = false,
  pagination,
}: TableProps<T>) {
  const { refresh, isRefreshing } = useDataRefresh();
  const [searchQuery, setSearchQuery] = useState('');
  const [showColumnsDropdown, setShowColumnsDropdown] = useState(false);

  // Handle search
  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);
      if (onSearch) {
        onSearch(query);
      }
    },
    [onSearch]
  );

  // Handle sort
  const handleSort = useCallback(
    (key: string) => {
      if (onSort) {
        let newSortOrder: 'asc' | 'desc' = 'asc';
        if (sortBy === key) {
          newSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
        }
        onSort(key);
      }
    },
    [sortBy, sortOrder, onSort]
  );

  // Handle row click
  const handleRowClick = useCallback(
    (item: T) => {
      if (onRowClick) {
        onRowClick(item);
      }
    },
    [onRowClick]
  );

  // Handle select row
  const handleSelectRow = useCallback(
    (id: string) => {
      if (onSelectRow) {
        onSelectRow(id);
      }
    },
    [onSelectRow]
  );

  // Handle select all
  const handleSelectAll = useCallback(() => {
    if (onSelectAll) {
      onSelectAll();
    }
  }, [onSelectAll]);

  // Check if all rows are selected
  const allSelected = useMemo(() => {
    return data.length > 0 && data.every((item) => selectedRows.includes(keyExtractor(item)));
  }, [data, keyExtractor, selectedRows]);

  // Get sort icon for column
  const getSortIcon = useCallback(
    (key: string) => {
      if (sortBy !== key) {
        return <ChevronsUpDown size={14} className="text-gray-400" />;
      }
      return sortOrder === 'asc' ? (
        <ChevronUp size={14} className="text-primary-600" />
      ) : (
        <ChevronDown size={14} className="text-primary-600" />
      );
    },
    [sortBy, sortOrder]
  );

  // Render header cell
  const renderHeaderCell = useCallback(
    (column: Column<T>) => {
      const isSorted = sortBy === column.key;
      const canSort = column.sortable !== false;

      return (
        <th
          key={String(column.key)}
          className={clsx(
            'px-4 py-3 bg-gray-50 text-gray-600 font-semibold text-sm uppercase tracking-wider border-b border-gray-200',
            {
              'cursor-pointer select-none hover:bg-gray-100': canSort,
              'text-left': column.align !== 'center' && column.align !== 'right',
              'text-center': column.align === 'center',
              'text-right': column.align === 'right',
            },
            column.className
          )}
          onClick={() => canSort && handleSort(String(column.key))}
          style={{ width: column.width }}
        >
          <div className="flex items-center justify-between">
            <span>{column.header}</span>
            {canSort && getSortIcon(String(column.key))}
          </div>
        </th>
      );
    },
    [sortBy, sortOrder, handleSort, getSortIcon]
  );

  // Render cell
  const renderCell = useCallback(
    (column: Column<T>, item: T, index: number) => {
    const value = (item as Record<string, unknown>)[String(column.key)];
    const content: React.ReactNode = column.render
      ? column.render(value, item, index)
      : value == null
        ? ''
        : String(value);

    return (
      <td
        key={String(column.key)}
        className={clsx(
          'px-4 py-3 border-b border-gray-100',
          {
            'text-left': column.align !== 'center' && column.align !== 'right',
            'text-center': column.align === 'center',
            'text-right': column.align === 'right',
          },
          column.className
        )}
      >
        {content}
      </td>
    );
  },
    []
  );

  // Render row
  const renderRow = useCallback(
    (item: T, index: number) => {
      const id = keyExtractor(item);
      const isSelected = selectedRows.includes(id);

      return (
        <tr
          key={id}
          onClick={() => handleRowClick(item)}
          className={clsx(
            'transition-colors duration-200',
            {
              'hover:bg-gray-50 cursor-pointer': onRowClick,
              'bg-primary-50/50': isSelected,
            }
          )}
        >
          {/* Selection checkbox */}
          {onSelectRow && (
            <td className="w-12 px-4 py-3 border-b border-gray-100">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  e.stopPropagation();
                  handleSelectRow(id);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
            </td>
          )}

          {columns.map((column) => renderCell(column, item, index))}
        </tr>
      );
    },
    [columns, keyExtractor, selectedRows, onRowClick, onSelectRow, handleRowClick, handleSelectRow, renderCell]
  );

  // Filtered and sorted data
  const processedData = useMemo(() => {
    let result = [...data];

    // Apply search filter
    if (searchQuery && onSearch) {
      // Search is handled externally
    }

    return result;
  }, [data, searchQuery, onSearch]);

  // Pagination controls
  const PaginationControls = () => {
    if (!pagination) return null;

    const {
      currentPage,
      totalPages,
      onPageChange,
      onPageSizeChange,
      pageSize = 10,
      totalItems = data.length,
      pageSizeOptions = [10, 25, 50, 100],
    } = pagination;

    return (
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">
            Showing {totalItems === 0 ? 0 : ((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, totalItems)} of {totalItems}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {onPageSizeChange && (
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="px-3 py-1 text-sm border border-gray-300 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            Previous
          </button>

          <span className="text-sm text-gray-500">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={clsx('bg-white rounded-lg shadow-card overflow-hidden', className)}>
      {/* Table header with actions */}
      {(searchable || filterable || actions) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center space-x-4">
            {searchable && (
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={handleSearch}
                  className="pl-10 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:outline-none w-64"
                />
              </div>
            )}

            {filterable && (
              <button
                onClick={() => setShowColumnsDropdown(!showColumnsDropdown)}
                className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              >
                <Filter size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {actions}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              aria-label="Refresh data"
              title={isRefreshing ? 'Refreshing data…' : 'Refresh data'}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg disabled:cursor-wait disabled:opacity-50"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => {}}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          {showHeader && (
            <thead>
              <tr>
                {onSelectRow && (
                  <th className="w-12 px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleSelectAll();
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                  </th>
                )}
                {columns.map(renderHeaderCell)}
              </tr>
            </thead>
          )}

          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectRow ? 1 : 0)}
                  className="px-4 py-8 text-center"
                >
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-4 border-primary-200 border-t-primary-600" />
                    <span className="text-gray-600">Loading...</span>
                  </div>
                </td>
              </tr>
            ) : processedData.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + (onSelectRow ? 1 : 0)}
                  className="px-4 py-8 text-center text-gray-500"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              processedData.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && <PaginationControls />}

      {/* Footer */}
      {showFooter && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
          {footerContent}
        </div>
      )}

      {/* Columns dropdown */}
      <AnimatePresence>
        {showColumnsDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full right-0 mt-2 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50"
          >
            <div className="p-2">
              <p className="text-sm font-medium text-gray-900 mb-2">Columns</p>
              {columns.map((column) => (
                <label
                  key={String(column.key)}
                  className="flex items-center px-3 py-2 text-sm hover:bg-gray-50 rounded-lg cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={true}
                    onChange={() => {}}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-3"
                  />
                  {column.header}
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Data Table with built-in sorting and filtering
interface DataTableProps<T> extends Omit<TableProps<T>, 'data' | 'onSort' | 'sortBy' | 'sortOrder'> {
  data: T[];
  initialSortBy?: string;
  initialSortOrder?: 'asc' | 'desc';
}

function DataTable<T>({
  data,
  initialSortBy,
  initialSortOrder = 'asc',
  columns,
  ...props
}: DataTableProps<T>) {
  const [sortBy, setSortBy] = useState<string | undefined>(initialSortBy);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialSortOrder);

  // Handle sort
  const handleSort = useCallback(
    (key: string) => {
      let newSortOrder: 'asc' | 'desc' = 'asc';
      if (sortBy === key) {
        newSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
      }
      setSortBy(key);
      setSortOrder(newSortOrder);
    },
    [sortBy, sortOrder]
  );

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortBy) return data;

    return [...data].sort((a, b) => {
      const aValue = (a as Record<string, unknown>)[sortBy];
      const bValue = (b as Record<string, unknown>)[sortBy];

      if (aValue === undefined || bValue === undefined) return 0;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
        return sortOrder === 'asc'
          ? (aValue ? 1 : -1) - (bValue ? 1 : -1)
          : (bValue ? 1 : -1) - (aValue ? 1 : -1);
      }

      return 0;
    });
  }, [data, sortBy, sortOrder]);

  return (
    <Table<T>
      {...props}
      data={sortedData}
      sortBy={sortBy}
      sortOrder={sortOrder}
      onSort={handleSort}
      columns={columns}
    />
  );
}

// Export components
Table.displayName = 'Table';
DataTable.displayName = 'DataTable';

export { Table, DataTable };
export type { Column, TableProps, DataTableProps };
