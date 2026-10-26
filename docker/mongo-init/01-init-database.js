/**
 * MongoDB Container Auto-Initialization Script
 * Executed automatically by the official mongo image on initial startup via /docker-entrypoint-initdb.d
 */

db = db.getSiblingDB("syncflow_db");

print("=== [MongoDB Init] Initializing Collections and $jsonSchema Validators for 'syncflow_db' ===");

// ------------------------------------------------------------------------------
// 1. Users Collection Validator
// ------------------------------------------------------------------------------
db.createCollection("users", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["first_name", "last_name", "date_of_birth", "is_admin", "username", "password_hash"],
      additionalProperties: true,
      properties: {
        _id: { bsonType: "objectId" },
        username: { bsonType: "string", description: "Unique username" },
        password_hash: { bsonType: "string", description: "Bcrypt hash" },
        first_name: { bsonType: "string" },
        last_name: { bsonType: "string" },
        gender: { bsonType: ["string", "null"], enum: ["Male", "Female", "Other", null], description: "User gender designation" },
        date_of_birth: { bsonType: "date" },
        is_admin: { bsonType: "bool" },
        email: { bsonType: ["string", "null"] },
        mobile_phone: { bsonType: ["string", "null"], description: "Optional mobile phone number" },
        created_at: { bsonType: "date" }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// Indexes for Users
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ role: 1 });

// ------------------------------------------------------------------------------
// 2. Projects Collection Validator
// ------------------------------------------------------------------------------
db.createCollection("projects", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["name", "description"],
      additionalProperties: true,
      properties: {
        _id: { bsonType: "objectId" },
        name: { bsonType: "string" },
        description: { bsonType: "string" },
        start_date: { bsonType: ["date", "null"] },
        created_by: { bsonType: ["objectId", "string", "null"] },
        created_at: { bsonType: "date" },
        updated_at: { bsonType: "date" },
        teams: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["team_id", "name", "member_ids"],
            properties: {
              team_id: { bsonType: ["string", "objectId"] },
              name: { bsonType: "string" },
              member_ids: {
                bsonType: "array",
                items: { bsonType: ["objectId", "string"] }
              }
            }
          }
        },
        controllers: {
          bsonType: "array",
          items: { bsonType: ["objectId", "string"] }
        },
        wbs: {
          bsonType: "array"
        },
        deliverables: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["deliverable_id", "name", "sub_deliverables"],
            properties: {
              deliverable_id: { bsonType: ["string", "objectId"] },
              name: { bsonType: "string" },
              description: { bsonType: ["string", "null"] },
              sub_deliverables: {
                bsonType: "array",
                items: {
                  bsonType: "object",
                  required: ["sub_deliverable_id", "name", "work_packages"],
                  properties: {
                    sub_deliverable_id: { bsonType: ["string", "objectId"] },
                    name: { bsonType: "string" },
                    description: { bsonType: ["string", "null"] },
                    work_packages: {
                      bsonType: "array",
                      items: {
                        bsonType: "object",
                        required: ["work_package_id", "name"],
                        properties: {
                          work_package_id: { bsonType: ["string", "objectId"] },
                          name: { bsonType: "string" },
                          description: { bsonType: ["string", "null"] }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        activities: {
          bsonType: "array"
        },
        dependencies: {
          bsonType: "array",
          items: {
            bsonType: "object",
            required: ["from_activity_id", "to_activity_id", "type"],
            properties: {
              from_activity_id: { bsonType: ["string", "objectId"] },
              to_activity_id: { bsonType: ["string", "objectId"] },
              type: {
                enum: [
                  "Finish-to-Start (FS)",
                  "Start-to-Finish (SF)",
                  "Start-to-Start (SS)",
                  "Finish-to-Finish (FF)",
                  "NULL"
                ]
              }
            }
          }
        }
      }
    }
  },
  validationLevel: "strict",
  validationAction: "error"
});

// Indexes for Projects
db.projects.createIndex({ name: 1 }, { unique: true });
db.projects.createIndex({ created_at: -1 });

// ------------------------------------------------------------------------------
// 3. Seed Initial Users (Check and load from users.json if exists)
// ------------------------------------------------------------------------------
var userMap = {};
var allUserIds = [];
var pmUserIds = [];

// Password hashing resolver (Cost 12 Bcrypt)
function resolvePasswordHash(plainPassword) {
  if (!plainPassword) {
    return "$2b$12$b6XxCOm1IjPbHetAGTvHmeFbwyMKOjuZo0PDCmaILVws0klJw2CGS"; // Default hash for "Mhanz0_0"
  }
  var knownHashes = {
    "Mhanz0_0": "$2b$12$b6XxCOm1IjPbHetAGTvHmeFbwyMKOjuZo0PDCmaILVws0klJw2CGS",
    "Password123!": "$2b$12$eX0hZ9mN.sT55pYf9Wj9reG1B1OtxZgL0K6yZlqJ6U2H.Q9N/Hj3q"
  };
  if (knownHashes[plainPassword]) {
    return knownHashes[plainPassword];
  }
  return "$2b$12$b6XxCOm1IjPbHetAGTvHmeFbwyMKOjuZo0PDCmaILVws0klJw2CGS";
}

const fs = require("fs");
const usersJsonPath = "/docker-entrypoint-initdb.d/users.json";

if (fs.existsSync(usersJsonPath)) {
  print("=== [MongoDB Init] Found users.json at " + usersJsonPath + ". Parsing initial users... ===");
  try {
    const rawContent = fs.readFileSync(usersJsonPath, "utf8");
    const jsonUsers = JSON.parse(rawContent);
    print("=== [MongoDB Init] Processing " + jsonUsers.length + " users from users.json ===");

    var userDocs = [];
    var seenUsernames = {};

    for (var i = 0; i < jsonUsers.length; i++) {
      var u = jsonUsers[i];
      var rawUsername = (u.username || "user_" + (i + 1)).trim().toLowerCase();
      var finalUsername = rawUsername;
      var counter = 2;
      while (seenUsernames[finalUsername]) {
        finalUsername = rawUsername + counter;
        counter++;
      }
      seenUsernames[finalUsername] = true;

      // Parse date_of_birth
      var dob = new Date("1995-01-01T00:00:00Z");
      if (u.date_of_birth) {
        if (typeof u.date_of_birth === "object" && u.date_of_birth.$date) {
          dob = new Date(u.date_of_birth.$date);
        } else {
          dob = new Date(u.date_of_birth);
        }
      }

      // Parse created_at
      var createdAt = new Date();
      if (u.created_at) {
        if (typeof u.created_at === "object" && u.created_at.$date) {
          createdAt = new Date(u.created_at.$date);
        } else {
          createdAt = new Date(u.created_at);
        }
      }

      var uId = new ObjectId();
      userMap[finalUsername] = uId;
      allUserIds.push(uId);

      var isAdmin = Boolean(u.is_admin);
      if (isAdmin || (u.role && u.role.trim() === "Project Manager")) {
        pmUserIds.push(uId);
      }

      var passwordHash = resolvePasswordHash(u.password);

      // Structure document with gender placed between last_name and username
      var doc = {
        _id: uId,
        first_name: (u.first_name || "").trim(),
        last_name: (u.last_name || "").trim(),
        gender: u.gender || null,
        username: finalUsername,
        password_hash: passwordHash,
        date_of_birth: dob,
        is_admin: isAdmin,
        role: (u.role || "Developer").trim(),
        email: u.email ? u.email.trim() : null,
        mobile_phone: u.mobile_phone ? String(u.mobile_phone).trim() : null,
        created_at: createdAt,
        updated_at: createdAt
      };

      userDocs.push(doc);
    }

    if (userDocs.length > 0) {
      db.users.insertMany(userDocs);
      print("=== [MongoDB Init] Successfully inserted " + userDocs.length + " users into 'users' collection ===");
    }
  } catch (err) {
    print("=== [MongoDB Init Error] Failed to load users.json: " + err + " ===");
  }
} else {
  print("=== [MongoDB Init] users.json not found at " + usersJsonPath + ". Using fallback seed users. ===");
  var aliceId = new ObjectId();
  var bobId = new ObjectId();
  var carolId = new ObjectId();

  userMap["pm_alice"] = aliceId;
  userMap["dev_bob"] = bobId;
  userMap["ctrl_carol"] = carolId;
  allUserIds.push(aliceId, bobId, carolId);
  pmUserIds.push(aliceId);

  db.users.insertMany([
    {
      _id: aliceId,
      first_name: "Alice",
      last_name: "Vance",
      gender: "Female",
      username: "pm_alice",
      password_hash: "$2b$12$eX0hZ9mN.sT55pYf9Wj9reG1B1OtxZgL0K6yZlqJ6U2H.Q9N/Hj3q", // "Password123!"
      date_of_birth: new Date("1988-05-14T00:00:00Z"),
      is_admin: true,
      role: "Project Manager",
      email: "alice.vance@company.com",
      mobile_phone: "+1-555-0144",
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      _id: bobId,
      first_name: "Bob",
      last_name: "Miller",
      gender: "Male",
      username: "dev_bob",
      password_hash: "$2b$12$eX0hZ9mN.sT55pYf9Wj9reG1B1OtxZgL0K6yZlqJ6U2H.Q9N/Hj3q", // "Password123!"
      date_of_birth: new Date("1994-09-21T00:00:00Z"),
      is_admin: false,
      role: "Developer",
      email: "bob.miller@company.com",
      mobile_phone: "+1-555-0178",
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      _id: carolId,
      first_name: "Carol",
      last_name: "Danvers",
      gender: "Female",
      username: "ctrl_carol",
      password_hash: "$2b$12$eX0hZ9mN.sT55pYf9Wj9reG1B1OtxZgL0K6yZlqJ6U2H.Q9N/Hj3q", // "Password123!"
      date_of_birth: new Date("1991-12-03T00:00:00Z"),
      is_admin: false,
      role: "Project Controller",
      email: "carol.danvers@company.com",
      mobile_phone: "+1-555-0192",
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);
}

// ------------------------------------------------------------------------------
// 4. Seed Projects (Check and load from projects.json if exists)
// ------------------------------------------------------------------------------
function reviveBson(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map(reviveBson);
  }
  if (typeof val === "object") {
    var keys = Object.keys(val);
    if (keys.length === 1 && keys[0] === "$oid") {
      return new ObjectId(val.$oid);
    }
    if (keys.length === 1 && keys[0] === "$date") {
      return new Date(val.$date);
    }
    var res = {};
    for (var k in val) {
      if (Object.prototype.hasOwnProperty.call(val, k)) {
        res[k] = reviveBson(val[k]);
      }
    }
    return res;
  }
  return val;
}

const projectsJsonPath = "/docker-entrypoint-initdb.d/projects.json";

if (fs.existsSync(projectsJsonPath)) {
  print("=== [MongoDB Init] Found projects.json at " + projectsJsonPath + ". Parsing projects... ===");
  try {
    const rawContent = fs.readFileSync(projectsJsonPath, "utf8");
    const jsonProjects = JSON.parse(rawContent);
    const revivedProjects = jsonProjects.map(reviveBson);
    if (revivedProjects.length > 0) {
      db.projects.insertMany(revivedProjects);
      print("=== [MongoDB Init] Successfully inserted " + revivedProjects.length + " projects into 'projects' collection ===");
    }
  } catch (err) {
    print("=== [MongoDB Init Error] Failed to load projects.json: " + err + " ===");
  }
} else {
  print("=== [MongoDB Init] projects.json not found at " + projectsJsonPath + ". Using fallback seed project. ===");
  var primaryPmId = pmUserIds.length > 0 ? pmUserIds[0] : allUserIds[0];
  var member1 = allUserIds.length > 1 ? allUserIds[1] : primaryPmId;
  var member2 = allUserIds.length > 2 ? allUserIds[2] : primaryPmId;

  var aliceId = primaryPmId;
  var bobId = member1;
  var carolId = member2;

  db.projects.insertOne({
    name: "SyncFlow Schedule Management Platform",
    description: "SyncFlow is an enterprise web application utilizing NLP and LLMs to automate Work Breakdown Structure creation and project network scheduling.",
    created_by: primaryPmId.toString(),
    created_at: new Date(),
    updated_at: new Date(),
    teams: [
      {
        team_id: "TEAM-ENG",
        name: "Core Engineering Team",
        member_ids: [member1.toString(), primaryPmId.toString()]
      },
      {
        team_id: "TEAM-QA",
        name: "Quality Assurance Team",
        member_ids: [member2.toString()]
      }
    ],
    activities: [
      {
        activity_id: "ACT-1.0",
        name: "Requirement Analysis & Architecture",
        description: "Define business specifications, data schemas, and containerized runtime architecture.",
        start_date: new Date("2026-10-12T00:00:00Z"),
        estimated_end_date: new Date("2026-10-16T00:00:00Z"),
        actual_end_date: null,
        optimistic_time: 3,
        most_likely_time: 5,
        pessimistic_time: 8,
        tasks: [
          {
            task_id: "TSK-1.1",
            name: "Stakeholder Elicitation & NLP Scoping",
            description: "Gather requirements from project management team and establish Text-to-WBS criteria.",
            task_type: "Analysis",
            assigned_to: { type: "User", id: aliceId.toString() },
            controller_id: carolId.toString(),
            start_date: new Date("2026-10-12T00:00:00Z"),
            estimated_end_date: new Date("2026-10-14T00:00:00Z"),
            actual_end_date: new Date("2026-10-14T00:00:00Z"),
            operations: [
              {
                operation_id: "OP-1.1.1",
                name: "Conduct PM interviews",
                description: "Meet with lead project managers to document manual scheduling pain points.",
                assigned_to: { type: "User", id: aliceId.toString() },
                status: "Finished",
                link_type: "Sequential"
              },
              {
                operation_id: "OP-1.1.2",
                name: "Synthesize Project Charter templates",
                description: "Prepare realistic sample project charter inputs for LLM prompt testing.",
                assigned_to: { type: "User", id: aliceId.toString() },
                status: "Finished",
                link_type: "Sequential"
              }
            ]
          },
          {
            task_id: "TSK-1.2",
            name: "NoSQL Database & Container Architecture",
            description: "Design MongoDB document schema and Docker multi-service deployment.",
            task_type: "Architecture",
            assigned_to: { type: "Team", id: "TEAM-ENG" },
            controller_id: carolId.toString(),
            start_date: new Date("2026-10-14T00:00:00Z"),
            estimated_end_date: new Date("2026-10-16T00:00:00Z"),
            actual_end_date: null,
            operations: [
              {
                operation_id: "OP-1.2.1",
                name: "Define MongoDB $jsonSchema validators",
                description: "Specify BSON schema constraints for users and projects collections.",
                assigned_to: { type: "User", id: bobId.toString() },
                status: "Finished",
                link_type: "Parallel"
              },
              {
                operation_id: "OP-1.2.2",
                name: "Configure Docker Compose & Mongo Express",
                description: "Set up multi-container environment with persistent volume storage.",
                assigned_to: { type: "User", id: bobId.toString() },
                status: "Work-in-Progress",
                link_type: "Parallel"
              }
            ]
          }
        ]
      },
      {
        activity_id: "ACT-2.0",
        name: "Core Application & NLP Development",
        description: "Implement Streamlit frontend, PyMongo repositories, and Gemini structured output parser.",
        start_date: new Date("2026-10-17T00:00:00Z"),
        estimated_end_date: new Date("2026-10-24T00:00:00Z"),
        actual_end_date: null,
        optimistic_time: 7,
        most_likely_time: 10,
        pessimistic_time: 16,
        tasks: [
          {
            task_id: "TSK-2.1",
            name: "Streamlit GUI & Visualizers",
            description: "Develop multi-phase UI views and Graphviz tree/network chart renderers.",
            task_type: "Frontend",
            assigned_to: { type: "User", id: bobId.toString() },
            controller_id: carolId.toString(),
            start_date: new Date("2026-10-17T00:00:00Z"),
            estimated_end_date: new Date("2026-10-21T00:00:00Z"),
            actual_end_date: null,
            operations: [
              {
                operation_id: "OP-2.1.1",
                name: "Build Plan & Define Activities GUI",
                description: "Create collapsible nested expanders for Activities, Tasks, Operations.",
                assigned_to: { type: "User", id: bobId.toString() },
                status: "Not Started",
                link_type: "Sequential"
              },
              {
                operation_id: "OP-2.1.2",
                name: "Render Graphviz TB Tree and LR Precedence Network",
                description: "Dynamic DOT visualizers for hierarchy and dependency graph.",
                assigned_to: { type: "User", id: bobId.toString() },
                status: "Not Started",
                link_type: "Parallel"
              }
            ]
          }
        ]
      },
      {
        activity_id: "ACT-3.0",
        name: "Testing, Deployment & Documentation",
        description: "Perform end-to-end user verification and draft academic project report.",
        start_date: new Date("2026-10-24T00:00:00Z"),
        estimated_end_date: new Date("2026-10-26T00:00:00Z"),
        actual_end_date: null,
        optimistic_time: 2,
        most_likely_time: 3,
        pessimistic_time: 5,
        tasks: [
          {
            task_id: "TSK-3.1",
            name: "Quality Validation & Report Writing",
            description: "Comprehensive functional testing and drafting the 6-12 page research paper.",
            task_type: "Documentation",
            assigned_to: { type: "Team", id: "TEAM-QA" },
            controller_id: aliceId.toString(),
            start_date: new Date("2026-10-24T00:00:00Z"),
            estimated_end_date: new Date("2026-10-26T00:00:00Z"),
            actual_end_date: null,
            operations: [
              {
                operation_id: "OP-3.1.1",
                name: "Validate Critical Path & PERT Calculations",
                description: "Verify calculation accuracy across cyclic/acyclic dependency tests.",
                assigned_to: { type: "User", id: carolId.toString() },
                status: "Not Started",
                link_type: "Parallel"
              }
            ]
          }
        ]
      }
    ],
    dependencies: [
      {
        from_activity_id: "ACT-1.0",
        to_activity_id: "ACT-2.0",
        type: "Finish-to-Start (FS)"
      },
      {
        from_activity_id: "ACT-2.0",
        to_activity_id: "ACT-3.0",
        type: "Finish-to-Start (FS)"
      }
    ]
  });
}

// ------------------------------------------------------------------------------
// 5. Seed Notifications (Check and load from notifications.json if exists)
// ------------------------------------------------------------------------------
const notifsJsonPath = "/docker-entrypoint-initdb.d/notifications.json";

if (fs.existsSync(notifsJsonPath)) {
  print("=== [MongoDB Init] Found notifications.json at " + notifsJsonPath + ". Parsing notifications... ===");
  try {
    const rawContent = fs.readFileSync(notifsJsonPath, "utf8");
    const jsonNotifs = JSON.parse(rawContent);
    const revivedNotifs = jsonNotifs.map(reviveBson);
    if (revivedNotifs.length > 0) {
      db.notifications.insertMany(revivedNotifs);
      print("=== [MongoDB Init] Successfully inserted " + revivedNotifs.length + " notifications into 'notifications' collection ===");
    }
  } catch (err) {
    print("=== [MongoDB Init Error] Failed to load notifications.json: " + err + " ===");
  }
}

print("=== [MongoDB Init] Schema validation and seed data successfully initialized! ===");

