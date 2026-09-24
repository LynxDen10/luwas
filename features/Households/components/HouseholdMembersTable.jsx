'use client';

import { FiEdit, FiPlus, FiTrash2, FiUsers } from 'react-icons/fi';
import { capitalizeWords, formatFullName } from '../utils/householdFormat';

export default function HouseholdMembersTable({
  isExpanded,
  data,
  members,
  loadingMembers,
  handleEditMember,
  handleDeleteMember,
  handleAddMember,
}) {
  if (!isExpanded) return null;

  const visibleMembers = members;

  const maleCount = visibleMembers.filter(
    (member) => (member.sex || '').toLowerCase() === 'male'
  ).length;

  const femaleCount = visibleMembers.filter(
    (member) => (member.sex || '').toLowerCase() === 'female'
  ).length;

  return (
    <tr>
      <td colSpan="10" className="border-b border-slate-200 bg-slate-50 px-4 py-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                  <FiUsers size={16} />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">
                    Household Members
                  </h4>
                  <p className="text-xs text-slate-500">
                    Members linked to household {data.householdId}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => handleAddMember(data.householdId)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
            >
              <FiPlus size={16} />
              Add Member
            </button>
          </div>

          {loadingMembers[data.householdId] ? (
            <p className="mt-2 animate-pulse text-sm text-slate-500">
              Loading household members...
            </p>
          ) : visibleMembers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
              <p className="text-sm text-slate-500">No household members found.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50">
                    <tr className="text-xs uppercase tracking-[0.08em] text-slate-500">
                      <th className="border-b border-slate-200 px-4 py-3 font-semibold min-w-[220px]">
                        Name
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 font-semibold min-w-[150px]">
                        Relation
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 font-semibold min-w-[90px]">
                        Sex
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 font-semibold min-w-[80px]">
                        Age
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 font-semibold min-w-[160px]">
                        Contact Number
                      </th>
                      <th className="border-b border-slate-200 px-4 py-3 text-center font-semibold min-w-[120px]">
                        Actions
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleMembers.map((member) => {
                      const name =
                        member.fullName ||
                        formatFullName({
                          firstName: member.firstName,
                          middleName: member.middleName,
                          lastName: member.lastName,
                          suffix: member.suffix,
                        }) ||
                        'Unnamed';

                      const rawRelation =
                        member.nuclearRelation || member.relationshipToHead || 'Unspecified';

                      const relationLabel = capitalizeWords(
                        rawRelation.includes(' - ')
                          ? rawRelation.split(' - ')[1].trim()
                          : rawRelation.trim()
                      );

                      const sex = capitalizeWords(member.sex || 'N/A');

                      return (
                        <tr key={member.memberId || member.id} className="transition hover:bg-slate-50">
                          <td className="border-b border-slate-200 px-4 py-4">
                            <p className="text-sm font-medium text-slate-800">{name}</p>
                          </td>

                          <td className="border-b border-slate-200 px-4 py-4 text-sm text-slate-700">
                            {relationLabel}
                          </td>

                          <td className="border-b border-slate-200 px-4 py-4 text-sm text-slate-700">
                            {sex}
                          </td>

                          <td className="border-b border-slate-200 px-4 py-4 text-sm text-slate-700">
                            {member.age || 'N/A'}
                          </td>

                          <td className="border-b border-slate-200 px-4 py-4 text-sm text-slate-700">
                            {member.contactNumber || 'N/A'}
                          </td>

                          <td className="border-b border-slate-200 px-4 py-4">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleEditMember(data.householdId, member)}
                                className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-700 transition hover:bg-blue-100"
                                title="Edit member"
                              >
                                <FiEdit size={16} />
                              </button>

                              <button
                                onClick={() =>
                                  handleDeleteMember(data.householdId, member.memberId || member.id)
                                }
                                className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 p-2 text-red-700 transition hover:bg-red-100"
                                title="Delete member"
                              >
                                <FiTrash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <div className="rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700 ring-1 ring-blue-100">
                  Male: {maleCount}
                </div>
                <div className="rounded-full bg-pink-50 px-3 py-1 text-sm font-medium text-pink-700 ring-1 ring-pink-100">
                  Female: {femaleCount}
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
                  Total Members: {visibleMembers.length}
                </div>
              </div>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
