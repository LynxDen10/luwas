import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

import admin, { adminDb } from '@/lib/firebaseAdmin';
import { getSessionUser } from '@/lib/auth/getSessionUser';

import {
  normalizeNameComponents,
  processHeadName,
} from '@/lib/utils/nameNormalizer';

export const runtime = 'nodejs';

const SUPPORTED_EXTENSIONS = ['json', 'xlsx', 'xls'];

const MAX_BATCH_OPERATIONS = 450;

const MAX_VALID_AGE = 120;

const EMPTY_VALUES = new Set([
  '',
  'n/a',
  'na',
  'null',
  'undefined',
  '-',
  '--',
  'none',
  'no data',
]);

/* =========================================================
   BASIC HELPERS
========================================================= */

function getFileExtension(fileName = '') {
  return String(fileName)
    .split('.')
    .pop()
    .toLowerCase();
}

function normalizeKey(value = '') {
  return String(value)
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

function getRowValue(row = {}, aliases = []) {
  const normalizedKeys = new Map(
    Object.keys(row).map((key) => [normalizeKey(key), key])
  );

  for (const alias of aliases) {
    const sourceKey = normalizedKeys.get(normalizeKey(alias));

    if (
      sourceKey &&
      row[sourceKey] !== undefined &&
      row[sourceKey] !== null
    ) {
      return row[sourceKey];
    }
  }

  return '';
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (EMPTY_VALUES.has(text.toLowerCase())) {
    return null;
  }

  return text;
}

/* =========================================================
   REPORTING
========================================================= */

function createReport(fileName) {
  return {
    fileName,

    householdsRead: 0,
    householdsImported: 0,

    membersRead: 0,
    membersImported: 0,

    repaired: 0,
    warnings: 0,
    blocked: 0,

    repairs: [],
    warningsList: [],
    blockedList: [],
  };
}

function addRepair(report, data) {
  report.repaired += 1;

  report.repairs.push({
    timestamp: new Date().toISOString(),
    ...data,
  });
}

function addWarning(report, data) {
  report.warnings += 1;

  report.warningsList.push({
    timestamp: new Date().toISOString(),
    ...data,
  });
}

function addBlocked(report, data) {
  report.blocked += 1;

  report.blockedList.push({
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/* =========================================================
   AGE
========================================================= */

function parseAge(value) {
  const cleaned = cleanText(value);

  if (cleaned === null) {
    return null;
  }

  const age = Number(cleaned);

  if (!Number.isFinite(age)) {
    return null;
  }

  if (!Number.isInteger(age)) {
    return null;
  }

  if (age < 0 || age > MAX_VALID_AGE) {
    return null;
  }

  return age;
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function calculateAge(birthdate, referenceDate = new Date()) {
  const birth = parseDate(birthdate);

  if (!birth) {
    return null;
  }

  let age =
    referenceDate.getFullYear() -
    birth.getFullYear();

  const monthDifference =
    referenceDate.getMonth() -
    birth.getMonth();

  if (
    monthDifference < 0 ||
    (
      monthDifference === 0 &&
      referenceDate.getDate() < birth.getDate()
    )
  ) {
    age -= 1;
  }

  if (age < 0 || age > MAX_VALID_AGE) {
    return null;
  }

  return age;
}

/**
 * Automatically repairs age when possible.
 *
 * Example:
 *
 * Age = -1996
 * Birthdate = valid
 *
 * Result:
 * Age = calculated age
 */
function resolveAge({
  age,
  birthdate,
  report,
  entityType,
  householdId,
  memberId,
}) {
  const parsedAge = parseAge(age);

  if (parsedAge !== null) {
    return parsedAge;
  }

  const calculatedAge = calculateAge(birthdate);

  if (calculatedAge !== null) {
    addRepair(report, {
      type: 'AGE_RECALCULATED',
      entityType,
      householdId,
      memberId,
      from: age,
      to: calculatedAge,
      reason: 'Age was missing or invalid and was recalculated from birthdate.',
    });

    return calculatedAge;
  }

  if (cleanText(age) !== null) {
    addWarning(report, {
      type: 'INVALID_AGE',
      entityType,
      householdId,
      memberId,
      value: age,
      reason: 'Age is outside the valid range and no valid birthdate was available.',
    });
  }

  return null;
}

/* =========================================================
   COORDINATES
========================================================= */

function parseCoordinate(value) {
  const cleaned = cleanText(value);

  if (cleaned === null) {
    return null;
  }

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function validateCoordinate(latitude, longitude) {
  if (
    latitude === null ||
    longitude === null
  ) {
    return null;
  }

  if (
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  // Almost certainly invalid for household mapping.
  if (latitude === 0 && longitude === 0) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function normalizeHomes(row, report, householdId) {
  const rawHomes = [
    {
      label: 'Primary Home',
      latitude: getRowValue(row, [
        'home1_latitude',
        'Home1 Latitude',
        'home1 latitude',
      ]),
      longitude: getRowValue(row, [
        'home1_longitude',
        'Home1 Longitude',
        'home1 longitude',
      ]),
    },

    {
      label: 'Secondary Home',
      latitude: getRowValue(row, [
        'home2_latitude',
        'Home2 Latitude',
        'home2 latitude',
      ]),
      longitude: getRowValue(row, [
        'home2_longitude',
        'Home2 Longitude',
        'home2 longitude',
      ]),
    },

    {
      label: 'Tertiary Home',
      latitude: getRowValue(row, [
        'home3_latitude',
        'Home3 Latitude',
        'home3 latitude',
      ]),
      longitude: getRowValue(row, [
        'home3_longitude',
        'Home3 Longitude',
        'home3 longitude',
      ]),
    },

    {
      label: 'Quaternary Home',
      latitude: getRowValue(row, [
        'home4_latitude',
        'Home4 Latitude',
        'home4 latitude',
      ]),
      longitude: getRowValue(row, [
        'home4_longitude',
        'Home4 Longitude',
        'home4 longitude',
      ]),
    },
  ];

  const homes = [];

  for (const home of rawHomes) {
    const latitude = parseCoordinate(home.latitude);
    const longitude = parseCoordinate(home.longitude);

    // Completely empty home.
    if (latitude === null && longitude === null) {
      continue;
    }

    const coordinate = validateCoordinate(
      latitude,
      longitude
    );

    if (!coordinate) {
      addWarning(report, {
        type: 'INVALID_COORDINATE',
        householdId,
        home: home.label,
        latitude: home.latitude,
        longitude: home.longitude,
        reason: 'Coordinate is incomplete, invalid, or 0,0.',
      });

      continue;
    }

    homes.push({
      label: home.label,
      ...coordinate,
    });
  }

  return homes;
}

/* =========================================================
   RELATIONSHIP NORMALIZATION
========================================================= */

const RELATIONSHIP_ALIASES = {
  child: 'Child',

  grandchild: 'Grandchild',
  'grand child': 'Grandchild',
  granchild: 'Grandchild',
  granddaughter: 'Grandchild',
  'grand daughter': 'Grandchild',
  grandson: 'Grandchild',

  spouse: 'Spouse',
  wife: 'Spouse',
  husband: 'Spouse',

  parent: 'Parent',
  mother: 'Parent',
  father: 'Parent',

  'daughter in law': 'Daughter-in-law',
  'daughter-in-law': 'Daughter-in-law',

  'son in law': 'Son-in-law',
  'son-in-law': 'Son-in-law',

  sibling: 'Sibling',
  brother: 'Sibling',
  sister: 'Sibling',
};

function normalizeRelationship(value, report, householdId, memberId) {
  const original = cleanText(value);

  if (!original) {
    return null;
  }

  const key = original
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const normalized =
    RELATIONSHIP_ALIASES[key];

  if (normalized && normalized !== original) {
    addRepair(report, {
      type: 'RELATIONSHIP_NORMALIZED',
      householdId,
      memberId,
      from: original,
      to: normalized,
    });

    return normalized;
  }

  return normalized || original;
}

/* =========================================================
   SEX
========================================================= */

function normalizeSex(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return null;
  }

  const key = cleaned.toLowerCase();

  if (
    key === 'm' ||
    key === 'male'
  ) {
    return 'Male';
  }

  if (
    key === 'f' ||
    key === 'female'
  ) {
    return 'Female';
  }

  return cleaned;
}

/* =========================================================
   PWD
========================================================= */

function parseBoolean(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return false;
  }

  return [
    'true',
    'yes',
    '1',
    'y',
  ].includes(cleaned.toLowerCase());
}

/* =========================================================
   MEMBER ID
========================================================= */

function normalizeMemberId(value) {
  const cleaned = cleanText(value);

  if (!cleaned) {
    return null;
  }

  if (/^\d+$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

function generateMemberDocumentId(
  householdId,
  originalMemberId,
  rowIndex
) {
  return crypto
    .createHash('sha1')
    .update(
      `${householdId}|${originalMemberId ?? 'missing'}|${rowIndex}|${Date.now()}`
    )
    .digest('hex')
    .slice(0, 24);
}

/* =========================================================
   FILE PARSER
========================================================= */

async function parseUploadFile(file) {
  const ext = getFileExtension(file.name);

  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      'Unsupported file type. Use JSON, XLSX, or XLS.'
    );
  }

  if (ext === 'json') {
    let data;

    try {
      data = JSON.parse(
        await file.text()
      );
    } catch {
      throw new Error(
        'Invalid JSON format.'
      );
    }

    return {
      householdRows: Array.isArray(data.households)
        ? data.households
        : [],

      memberRows: Array.isArray(data.members)
        ? data.members
        : [],
    };
  }

  const buffer = Buffer.from(
    await file.arrayBuffer()
  );

  const workbook = XLSX.read(
    buffer,
    {
      type: 'buffer',
      raw: true,
      cellDates: true,
    }
  );

  const householdSheetName =
    workbook.SheetNames.find(
      (name) =>
        [
          'household',
          'households',
        ].includes(
          name.trim().toLowerCase()
        )
    );

  const memberSheetName =
    workbook.SheetNames.find(
      (name) =>
        [
          'member',
          'members',
        ].includes(
          name.trim().toLowerCase()
        )
    );

  if (!householdSheetName) {
    throw new Error(
      'Missing Household sheet.'
    );
  }

  return {
    householdRows:
      XLSX.utils.sheet_to_json(
        workbook.Sheets[
          householdSheetName
        ],
        {
          defval: '',
        }
      ),

    memberRows: memberSheetName
      ? XLSX.utils.sheet_to_json(
          workbook.Sheets[
            memberSheetName
          ],
          {
            defval: '',
          }
        )
      : [],
  };
}

/* =========================================================
   HOUSEHOLD BUILDING
========================================================= */

function buildHouseholdsMap(
  householdRows,
  memberRows,
  report
) {
  const householdsMap = {};

  /* ---------------------------
     HOUSEHOLDS
  --------------------------- */

  householdRows.forEach(
    (row, rowIndex) => {
      report.householdsRead += 1;

      const householdId =
        cleanText(
          getRowValue(row, [
            'Household ID',
            'householdId',
            'household_id',
            'id',
          ])
        );

      if (!householdId) {
        addWarning(report, {
          type: 'MISSING_HOUSEHOLD_ID',
          row: rowIndex + 2,
          reason:
            'Household row has no Household ID and was skipped.',
        });

        return;
      }

      /* --------------------------------
         Duplicate household
      -------------------------------- */

      if (householdsMap[householdId]) {
        addWarning(report, {
          type: 'DUPLICATE_HOUSEHOLD_ID',
          householdId,
          row: rowIndex + 2,
          reason:
            'Duplicate Household ID encountered. Later row was merged over the existing record.',
        });
      }

      /* --------------------------------
         HEAD NAME
      -------------------------------- */

      const normalizedNames =
        processHeadName({
          headFirstName:
            getRowValue(row, [
              'headFirstName',
              'Head FirstName',
              'Head First Name',
            ]),

          headMiddleName:
            getRowValue(row, [
              'headMiddleName',
              'Head Middle Name',
              'Head MiddleName',
            ]),

          headLastName:
            getRowValue(row, [
              'headLastName',
              'Head Last Name',
              'Head LastName',
            ]),

          headSuffix:
            getRowValue(row, [
              'headSuffix',
              'Head Suffix',
            ]),

          headFullName:
            getRowValue(row, [
              'headFullName',
              'Head FullName',
              'Head Full Name',
            ]),
        });

      /* --------------------------------
         AGE
      -------------------------------- */

      const rawHeadAge =
        getRowValue(row, [
          'headAge',
          'Head Age',
        ]);

      const birthdate =
        getRowValue(row, [
          'headBirthdate',
          'Head Birthdate',
          'Head Birth Date',
          'birthdate',
          'Birthdate',
        ]);

      const headAge =
        resolveAge({
          age: rawHeadAge,
          birthdate,
          report,
          entityType: 'household',
          householdId,
        });

      householdsMap[
        householdId
      ] = {
        householdId,

        headFirstName:
          normalizedNames.firstName,

        headMiddleName:
          normalizedNames.middleName,

        headLastName:
          normalizedNames.lastName,

        headSuffix:
          normalizedNames.suffix,

        headSex: normalizeSex(
          getRowValue(row, [
            'headSex',
            'Head Sex',
          ])
        ),

        headAge,

        headBirthdate:
          birthdate || null,

        contactNumber:
          cleanText(
            getRowValue(row, [
              'headContactNumber',
              'Contact Number',
              'Head Contact Number',
            ])
          ),

        barangay:
          cleanText(
            getRowValue(row, [
              'barangay',
              'Barangay',
            ])
          ),

        sitio:
          cleanText(
            getRowValue(row, [
              'sitio',
              'Sitio',
            ])
          ),

        homes: normalizeHomes(
          row,
          report,
          householdId
        ),

        members: [],
      };

      report.householdsImported += 1;
    }
  );

  /* ---------------------------
     MEMBERS
  --------------------------- */

  let currentMemberHouseholdId = '';

  const usedMemberIds = new Map();

  memberRows.forEach(
    (row, rowIndex) => {
      report.membersRead += 1;

      const rowHouseholdId =
        cleanText(
          getRowValue(row, [
            'Household ID',
            'householdId',
            'household_id',
          ])
        );

      /*
       * Spreadsheet continuation rows:
       *
       * Household ID
       * 001
       * blank
       * blank
       *
       * Automatically carry ID downward.
       */

      if (rowHouseholdId) {
        currentMemberHouseholdId =
          rowHouseholdId;
      }

      const householdId =
        rowHouseholdId ||
        currentMemberHouseholdId;

      if (!householdId) {
        addWarning(report, {
          type: 'ORPHAN_MEMBER',
          row: rowIndex + 2,
          reason:
            'Member has no Household ID and no previous Household ID to inherit.',
        });

        return;
      }

      if (!householdsMap[householdId]) {
        addWarning(report, {
          type: 'ORPHAN_MEMBER',
          householdId,
          row: rowIndex + 2,
          reason:
            'Member references a Household ID that does not exist in the Household sheet.',
        });

        return;
      }

      /* --------------------------------
         MEMBER ID
      -------------------------------- */

      const rawMemberId =
        cleanText(
          getRowValue(row, [
            'Member ID',
            'memberId',
            'member_id',
            'id',
          ])
        );

      let memberId =
        normalizeMemberId(
          rawMemberId
        );

      /*
       * Invalid ID such as "I":
       * do not throw away the person.
       */

      if (!memberId) {
        addWarning(report, {
          type: 'INVALID_MEMBER_ID',
          householdId,
          row: rowIndex + 2,
          originalMemberId:
            rawMemberId,
          reason:
            'Member ID is missing or non-numeric. A generated Firestore ID will be used.',
        });

        memberId =
          generateMemberDocumentId(
            householdId,
            rawMemberId,
            rowIndex
          );
      }

      /* --------------------------------
         DUPLICATE MEMBER ID
      -------------------------------- */

      const duplicateKey =
        `${householdId}:${memberId}`;

      if (usedMemberIds.has(duplicateKey)) {
        const originalId =
          memberId;

        memberId =
          generateMemberDocumentId(
            householdId,
            originalId,
            rowIndex
          );

        addWarning(report, {
          type: 'DUPLICATE_MEMBER_ID',
          householdId,
          originalMemberId:
            originalId,
          generatedMemberId:
            memberId,
          row: rowIndex + 2,
          reason:
            'Duplicate Member ID detected. A unique Firestore document ID was generated.',
        });
      }

      usedMemberIds.set(
        `${householdId}:${memberId}`,
        true
      );

      /* --------------------------------
         MEMBER NAME
      -------------------------------- */

      const normalizedNames =
        normalizeNameComponents({
          firstName:
            getRowValue(row, [
              'firstName',
              'FirstName',
              'First Name',
            ]),

          middleName:
            getRowValue(row, [
              'middleName',
              'MiddleName',
              'Middle Name',
            ]),

          lastName:
            getRowValue(row, [
              'lastName',
              'LastName',
              'Last Name',
            ]),

          suffix:
            getRowValue(row, [
              'suffix',
              'Suffix',
            ]),
        });

      /* --------------------------------
         MEMBER AGE
      -------------------------------- */

      const rawAge =
        getRowValue(row, [
          'age',
          'Age',
        ]);

      const memberBirthdate =
        getRowValue(row, [
          'birthdate',
          'Birthdate',
          'Birth Date',
          'dateOfBirth',
          'Date of Birth',
        ]);

      const age =
        resolveAge({
          age: rawAge,
          birthdate: memberBirthdate,
          report,
          entityType: 'member',
          householdId,
          memberId,
        });

      /* --------------------------------
         MEMBER OBJECT
      -------------------------------- */

      householdsMap[
        householdId
      ].members.push({
        id: memberId,

        originalMemberId:
          rawMemberId || null,

        firstName:
          normalizedNames.firstName,

        middleName:
          normalizedNames.middleName,

        lastName:
          normalizedNames.lastName,

        suffix:
          normalizedNames.suffix,

        relationshipToHead:
          normalizeRelationship(
            getRowValue(row, [
              'relationshipToHead',
              'Relationship To Head',
            ]),
            report,
            householdId,
            memberId
          ),

        sex: normalizeSex(
          getRowValue(row, [
            'sex',
            'Sex',
          ])
        ),

        age,

        birthdate:
          memberBirthdate || null,

        contactNumber:
          cleanText(
            getRowValue(row, [
              'memberContactNumber',
              'Member Contact Number',
              'Contact Number',
            ])
          ),

        isPWD: parseBoolean(
          getRowValue(row, [
            'isPWD',
            'Is PWD',
          ])
        ),

        isSeniorCitizen:
          age !== null &&
          age >= 60,

        importMeta: {
          sourceRow:
            rowIndex + 2,

          importedAt:
            admin.firestore.FieldValue.serverTimestamp(),
        },
      });

      report.membersImported += 1;
    }
  );

  return Object.values(
    householdsMap
  );
}

/* =========================================================
   AGE BRACKETS
========================================================= */

function calculateAgeBrackets(
  members,
  headAge
) {
  const brackets = {
    'Under 1': 0,
    '1-4': 0,
    '5-9': 0,
    '10-14': 0,
    '15-19': 0,
    '20-24': 0,
    '25-29': 0,
    '30-34': 0,
    '35-39': 0,
    '40-44': 0,
    '45-49': 0,
    '50-54': 0,
    '55-59': 0,
    '60 and over': 0,
  };

  const addAge = (value) => {
    const age = Number(value);

    if (
      !Number.isFinite(age) ||
      age < 0
    ) {
      return;
    }

    if (age < 1) brackets['Under 1'] += 1;
    else if (age <= 4) brackets['1-4'] += 1;
    else if (age <= 9) brackets['5-9'] += 1;
    else if (age <= 14) brackets['10-14'] += 1;
    else if (age <= 19) brackets['15-19'] += 1;
    else if (age <= 24) brackets['20-24'] += 1;
    else if (age <= 29) brackets['25-29'] += 1;
    else if (age <= 34) brackets['30-34'] += 1;
    else if (age <= 39) brackets['35-39'] += 1;
    else if (age <= 44) brackets['40-44'] += 1;
    else if (age <= 49) brackets['45-49'] += 1;
    else if (age <= 54) brackets['50-54'] += 1;
    else if (age <= 59) brackets['55-59'] += 1;
    else brackets['60 and over'] += 1;
  };

  addAge(headAge);

  members.forEach(
    (member) =>
      addAge(member.age)
  );

  return brackets;
}

/* =========================================================
   HOUSEHOLD DOCUMENT
========================================================= */

function buildHouseholdDoc(
  household
) {
  const {
    householdId,
    headFirstName,
    headMiddleName,
    headLastName,
    headSuffix,
    headSex,
    headAge,
    headBirthdate,
    contactNumber,
    barangay,
    sitio,
    homes,
    members,
  } = household;

  const validHead =
    Boolean(
      headFirstName ||
      headLastName ||
      headMiddleName
    );

  const totalMembers =
    members.length;

  const totalMale =
    members.filter(
      (member) =>
        member.sex?.toLowerCase() ===
        'male'
    ).length +
    (
      headSex?.toLowerCase() ===
      'male'
        ? 1
        : 0
    );

  const totalFemale =
    members.filter(
      (member) =>
        member.sex?.toLowerCase() ===
        'female'
    ).length +
    (
      headSex?.toLowerCase() ===
      'female'
        ? 1
        : 0
    );

  const totalPWDs =
    members.filter(
      (member) =>
        member.isPWD
    ).length;

  const totalSeniors =
    (
      headAge !== null &&
      headAge >= 60
        ? 1
        : 0
    ) +
    members.filter(
      (member) =>
        member.age !== null &&
        member.age >= 60
    ).length;

  const totalResidents =
    (validHead ? 1 : 0) +
    totalMembers;

  return {
    householdId,

    headFirstName,
    headMiddleName,
    headLastName,
    headSuffix,

    headFullName: [
      headFirstName,
      headMiddleName,
      headLastName,
      headSuffix,
    ]
      .filter(Boolean)
      .join(' ')
      .trim(),

    headSex,
    headAge,
    headBirthdate,

    contactNumber,

    barangay,
    sitio,

    homes,

    hasMapLocation:
      homes.length > 0,

    ageBrackets:
      calculateAgeBrackets(
        members,
        headAge
      ),

    createdAt:
      admin.firestore.FieldValue.serverTimestamp(),

    updatedAt:
      admin.firestore.FieldValue.serverTimestamp(),

    totalResidents,

    totalMale,
    totalFemale,
    totalPWDs,
    totalSeniors,

    totalFamilies: 1,
  };
}

/* =========================================================
   FIRESTORE WRITER
========================================================= */

async function writeHouseholds(
  allHouseholds
) {
  let batch =
    adminDb.batch();

  let operationsInBatch = 0;
  let batchCount = 0;

  const commitBatch =
    async () => {
      if (
        operationsInBatch === 0
      ) {
        return;
      }

      await batch.commit();

      batch =
        adminDb.batch();

      operationsInBatch = 0;

      batchCount += 1;
    };

  for (
    const household of allHouseholds
  ) {
    if (
      operationsInBatch >=
      MAX_BATCH_OPERATIONS
    ) {
      await commitBatch();
    }

    const householdRef =
      adminDb
        .collection('households')
        .doc(
          household.householdId
        );

    batch.set(
      householdRef,
      buildHouseholdDoc(
        household
      ),
      {
        merge: true,
      }
    );

    operationsInBatch += 1;

    for (
      const member of household.members
    ) {
      if (
        operationsInBatch >=
        MAX_BATCH_OPERATIONS
      ) {
        await commitBatch();
      }

      const memberRef =
        householdRef
          .collection('members')
          .doc(member.id);

      batch.set(
        memberRef,
        member,
        {
          merge: true,
        }
      );

      operationsInBatch += 1;
    }
  }

  await commitBatch();

  return batchCount;
}

/* =========================================================
   API
========================================================= */

export async function POST(
  request
) {
  try {
    /* --------------------------------
       AUTH
    -------------------------------- */

    const user =
      await getSessionUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            'Unauthorized: Authentication required',
        },
        {
          status: 401,
        }
      );
    }

    if (
      user.role !==
      'MDRRMC-Admin'
    ) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Admin access required',
        },
        {
          status: 403,
        }
      );
    }

    /* --------------------------------
       FILE
    -------------------------------- */

    const formData =
      await request.formData();

    const file =
      formData.get('file');

    if (
      !file ||
      typeof file === 'string'
    ) {
      return NextResponse.json(
        {
          error:
            'Upload file is required',
        },
        {
          status: 400,
        }
      );
    }

    /* --------------------------------
       PARSE
    -------------------------------- */

    const {
      householdRows,
      memberRows,
    } =
      await parseUploadFile(
        file
      );

    if (
      !householdRows.length
    ) {
      return NextResponse.json(
        {
          error:
            'Households sheet is empty',
        },
        {
          status: 400,
        }
      );
    }

    /* --------------------------------
       REPORT
    -------------------------------- */

    const report =
      createReport(
        file.name
      );

    /* --------------------------------
       BUILD + REPAIR
    -------------------------------- */

    const allHouseholds =
      buildHouseholdsMap(
        householdRows,
        memberRows,
        report
      );

    /* --------------------------------
       WRITE
    -------------------------------- */

    const batchCount =
      await writeHouseholds(
        allHouseholds
      );

    /* --------------------------------
       RESPONSE
    -------------------------------- */

    return NextResponse.json({
      success: true,

      message:
        'LUWAS successfully imported and normalized the spreadsheet data.',

      count:
        allHouseholds.length,

      batchCount,

      report: {
        householdsRead:
          report.householdsRead,

        householdsImported:
          report.householdsImported,

        membersRead:
          report.membersRead,

        membersImported:
          report.membersImported,

        repaired:
          report.repaired,

        warnings:
          report.warnings,

        blocked:
          report.blocked,
      },

      repairs:
        report.repairs,

      warnings:
        report.warningsList,

      blocked:
        report.blockedList,
    });
  } catch (error) {
    console.error(
      'POST /api/households/upload error:',
      error
    );

    return NextResponse.json(
      {
        error:
          error.message ||
          'Failed to upload household data',
      },
      {
        status: 500,
      }
    );
  }
}
