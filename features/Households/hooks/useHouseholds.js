'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-toastify';
import { downloadCsvFile, openPrintWindow, printTable } from '@/lib/utils/clientExport';
import { compareNames } from '@/lib/utils/nameNormalizer';
import * as householdApi from '../services/householdApi';
import { normalizeHousehold, normalizeMember } from '../utils/householdFormat';

const PAGE_SIZE = 10;
const HOUSEHOLD_EXPORT_HEADERS = [
  'No.',
  'Household ID',
  'Family Head',
  'Barangay',
  'Sitio',
  'Sex',
  'Contact',
  'Age',
  'Total Residents',
  'Total PWDs',
  'Total Seniors',
];

function compareHouseholdHeadNames(left = {}, right = {}) {
  return compareNames(
    {
      firstName: left.headFirstName,
      middleName: left.headMiddleName,
      lastName: left.headLastName,
      suffix: left.headSuffix,
    },
    {
      firstName: right.headFirstName,
      middleName: right.headMiddleName,
      lastName: right.headLastName,
      suffix: right.headSuffix,
    }
  );
}

function compareMemberNames(left = {}, right = {}) {
  return compareNames(
    {
      firstName: left.firstName,
      middleName: left.middleName,
      lastName: left.lastName,
      suffix: left.suffix,
    },
    {
      firstName: right.firstName,
      middleName: right.middleName,
      lastName: right.lastName,
      suffix: right.suffix,
    }
  );
}

function buildHouseholdExportRows(households = []) {
  return households.map((household, index) => [
    index + 1,
    household.householdId || '',
    household.headFullName || 'Unnamed',
    household.barangay || 'N/A',
    household.sitio || 'N/A',
    household.headSex || 'N/A',
    household.contactNumber || 'N/A',
    household.headAge ?? 'N/A',
    Number(household.totalResidents || 0),
    Number(household.totalPWDs || 0),
    Number(household.totalSeniors || 0),
  ]);
}

export function useHouseholds() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [totalHouseholds, setTotalHouseholds] = useState(0);
  const [totalResidents, setTotalResidents] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);

  const [expandedHouseholds, setExpandedHouseholds] = useState({});
  const [loadingMembers, setLoadingMembers] = useState({});
  const [membersData, setMembersData] = useState({});

  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const fetchPage = useCallback(async () => {
    try {
      setLoading(true);

      const result = await householdApi.fetchHouseholds({
        page,
        limit: PAGE_SIZE,
        search,
        sort: 'headLastName',
        order: 'asc',
      });

      const householdsWithId = (result.households || [])
        .filter((household) => household && household.householdId)
        .map((household) => normalizeHousehold(household))
        .sort(compareHouseholdHeadNames);

      if (householdsWithId.length !== (result.households || []).length) {
        console.warn(
          'Some households missing householdId:',
          (result.households || []).filter((household) => !household || !household.householdId)
        );
      }

      setItems(householdsWithId);
      setTotalHouseholds(result.totalHouseholds || 0);
      setTotalResidents(result.totalResidents || 0);
      setTotalPages(result.totalPages || 1);
      setHasNextPage(Boolean(result.hasNextPage));
      setHasPrevPage(Boolean(result.hasPrevPage));
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to fetch households');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const handleSearchSubmit = useCallback(
    (event) => {
      event?.preventDefault?.();
      setPage(1);
      setSearch(searchInput.trim());
    },
    [searchInput]
  );

  const fetchAllFilteredHouseholds = useCallback(async () => {
    const result = await householdApi.fetchHouseholds({
      page: 1,
      limit: PAGE_SIZE,
      search,
      sort: 'headLastName',
      order: 'asc',
      exportAll: true,
    });

    const households = (result.households || [])
      .filter((household) => household && household.householdId)
      .map((household) => normalizeHousehold(household))
      .sort(compareHouseholdHeadNames);

    return {
      households,
      totalHouseholds: result.totalHouseholds || households.length,
      totalResidents: result.totalResidents || 0,
    };
  }, [search]);

  const printAll = useCallback(async () => {
    let printWindow = null;

    try {
      printWindow = openPrintWindow('Household Records');
      setExporting(true);

      const { households, totalHouseholds: householdCount, totalResidents: residentCount } =
        await fetchAllFilteredHouseholds();

      if (!households.length) {
        printWindow.close();
        toast.info('No household records available to print.');
        return;
      }

      printTable({
        printWindow,
        title: 'Household Records',
        subtitle: search
          ? `Filtered by search: ${search}`
          : 'All matching household records',
        headers: HOUSEHOLD_EXPORT_HEADERS,
        rows: buildHouseholdExportRows(households),
        summaryLines: [
          `Total Households: ${householdCount}`,
          `Total Residents: ${residentCount}`,
        ],
      });
    } catch (error) {
      if (printWindow) {
        printWindow.close();
      }

      console.error(error);
      toast.error(error.message || 'Failed to print household records');
    } finally {
      setExporting(false);
    }
  }, [fetchAllFilteredHouseholds, search]);

  const downloadCSV = useCallback(async () => {
    try {
      setExporting(true);

      const { households } = await fetchAllFilteredHouseholds();

      if (!households.length) {
        toast.info('No household records available to download.');
        return;
      }

      downloadCsvFile({
        filename: 'household-records.csv',
        headers: HOUSEHOLD_EXPORT_HEADERS,
        rows: buildHouseholdExportRows(households),
      });
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to download household records');
    } finally {
      setExporting(false);
    }
  }, [fetchAllFilteredHouseholds]);

  const toggleExpanded = useCallback(
    (householdId) => {
      if (!householdId) {
        console.error('toggleExpanded: householdId is missing or undefined', { householdId });
        toast.error('Error: Household ID is missing');
        return;
      }

      setExpandedHouseholds((prev) => {
        const willOpen = !prev[householdId];

        if (willOpen && !membersData[householdId]) {
          (async () => {
            try {
              setLoadingMembers((prevLoading) => ({
                ...prevLoading,
                [householdId]: true,
              }));

              const firstResult = await householdApi.fetchMembers(householdId, {
                page: 1,
                limit: 100,
              });
              const allMembers = [...(firstResult.members || [])];

              for (let nextPage = 2; nextPage <= (firstResult.totalPages || 1); nextPage += 1) {
                const pageResult = await householdApi.fetchMembers(householdId, {
                  page: nextPage,
                  limit: 100,
                });
                allMembers.push(...(pageResult.members || []));
              }

              const normalizedMembers = allMembers
                .map((member) => normalizeMember(member))
                .sort(compareMemberNames);

              setMembersData((prevMembers) => ({
                ...prevMembers,
                [householdId]: normalizedMembers,
              }));
            } catch (error) {
              console.error('Failed to fetch members for household:', { householdId, error });
              toast.error(error.message || 'Failed to fetch household members');
            } finally {
              setLoadingMembers((prevLoading) => ({
                ...prevLoading,
                [householdId]: false,
              }));
            }
          })();
        }

        return {
          ...prev,
          [householdId]: willOpen,
        };
      });
    },
    [membersData]
  );

  const handleDeleteHousehold = useCallback(
    async (householdId) => {
      const confirmed = window.confirm(
        'Delete this household and all members? This action cannot be undone.'
      );

      if (!confirmed) return;

      try {
        setSubmitting(true);
        await householdApi.deleteHousehold(householdId);
        toast.success('Household deleted successfully');

        setExpandedHouseholds((prev) => {
          const next = { ...prev };
          delete next[householdId];
          return next;
        });

        setMembersData((prev) => {
          const next = { ...prev };
          delete next[householdId];
          return next;
        });

        await fetchPage();
      } catch (error) {
        console.error(error);
        toast.error(error.message || 'Failed to delete household');
      } finally {
        setSubmitting(false);
      }
    },
    [fetchPage]
  );

  const handleDeleteMember = useCallback(
    async (householdId, memberId) => {
      const confirmed = window.confirm(
        'Delete this member? This action cannot be undone.'
      );

      if (!confirmed) return;

      try {
        await householdApi.deleteMember(householdId, memberId);
        toast.success('Member deleted successfully');

        setMembersData((prev) => ({
          ...prev,
          [householdId]: (prev[householdId] || []).filter(
            (member) => member.memberId !== memberId
          ),
        }));

        await fetchPage();
      } catch (error) {
        console.error(error);
        toast.error(error.message || 'Failed to delete member');
      }
    },
    [fetchPage]
  );

  const handleUploadHouseholdData = useCallback(() => {
    setUploadModalOpen(true);
  }, []);

  const handleAddHouseholdClick = useCallback(() => {
    router.push('/household/quick-add');
  }, [router]);

  const handleUploadSuccess = useCallback(async () => {
    setPage(1);
    await fetchPage();
  }, [fetchPage]);

  const summary = useMemo(
    () => ({
      totalHouseholds,
      totalResidents,
      totalPages,
      hasNextPage,
      hasPrevPage,
    }),
    [totalHouseholds, totalResidents, totalPages, hasNextPage, hasPrevPage]
  );

  return {
    loading,
    submitting,
    exporting,
    households: items,
    filteredHouseholds: items,
    expandedHouseholds,
    membersData,
    loadingMembers,

    page,
    totalPages,
    totalHouseholds,
    totalResidents,
    hasNextPage,
    hasPrevPage,
    summary,

    searchInput,
    setSearchInput,
    handleSearchSubmit,
    setPage,
    toggleExpanded,

    handleDeleteHousehold,
    handleDeleteMember,
    handleAddHouseholdClick,
    printAll,
    downloadCSV,

    uploadModalOpen,
    setUploadModalOpen,
    handleUploadSuccess,
    handleUploadHouseholdData,
  };
}
