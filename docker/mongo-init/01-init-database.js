/**
 * MongoDB Container Auto-Initialization Script
 * Executed automatically by the official mongo image on initial startup via /docker-entrypoint-initdb.d
 * 
 * Sets up database 'syncflow_db' with all required collections, $jsonSchema validators,
 * and performance/uniqueness indexes, leaving the collections empty.
 * Seed data can be imported separately using the populate_db.py script.
 */

db = db.getSiblingDB("syncflow_db");

print("=== [MongoDB Init] Initializing Collections and $jsonSchema Validators for 'syncflow_db' ===");

var existingCols = db.getCollectionNames();

function safeCreateIndex(col, key, opts) {
  try {
    col.createIndex(key, opts || {});
  } catch (err) {
    // Suppress if already exists with compatible options
  }
}

// ------------------------------------------------------------------------------
// 1. Users Collection Validator & Indexes
// ------------------------------------------------------------------------------
var usersValidator = {
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
      role: { bsonType: ["string", "null"] },
      email: { bsonType: ["string", "null"] },
      mobile_phone: { bsonType: ["string", "null"], description: "Optional mobile phone number" },
      created_at: { bsonType: "date" },
      updated_at: { bsonType: ["date", "null"] }
    }
  }
};

if (!existingCols.includes("users")) {
  db.createCollection("users", {
    validator: usersValidator,
    validationLevel: "strict",
    validationAction: "error"
  });
  print("=== [MongoDB Init] Collection 'users' created with strict validator. ===");
} else {
  try {
    db.runCommand({
      collMod: "users",
      validator: usersValidator,
      validationLevel: "strict",
      validationAction: "error"
    });
    print("=== [MongoDB Init] Collection 'users' validator updated via collMod. ===");
  } catch (e) {
    print("=== [MongoDB Init Notice] collMod users: " + e + " ===");
  }
}

safeCreateIndex(db.users, { username: 1 }, { unique: true });
safeCreateIndex(db.users, { email: 1 }, { unique: true, sparse: true });
safeCreateIndex(db.users, { role: 1 });

// ------------------------------------------------------------------------------
// 2. Projects Collection Validator & Indexes
// ------------------------------------------------------------------------------
var projectsValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["name", "description"],
    additionalProperties: true,
    properties: {
      _id: { bsonType: "objectId" },
      name: { bsonType: "string" },
      description: { bsonType: "string" },
      status: { bsonType: ["string", "null"] },
      start_date: { bsonType: ["date", "null"] },
      created_by: { bsonType: ["objectId", "string", "null"] },
      created_at: { bsonType: "date" },
      updated_at: { bsonType: "date" },
      assigned_user_ids: {
        bsonType: "array",
        items: { bsonType: ["objectId", "string"] }
      },
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
            },
            lead_id: {
              bsonType: ["objectId", "string", "null"],
              description: "Designated Team Lead User ID"
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
                "FS",
                "SF",
                "SS",
                "FF",
                "NULL"
              ]
            }
          }
        }
      }
    }
  }
};

if (!existingCols.includes("projects")) {
  db.createCollection("projects", {
    validator: projectsValidator,
    validationLevel: "strict",
    validationAction: "error"
  });
  print("=== [MongoDB Init] Collection 'projects' created with strict validator. ===");
} else {
  try {
    db.runCommand({
      collMod: "projects",
      validator: projectsValidator,
      validationLevel: "strict",
      validationAction: "error"
    });
    print("=== [MongoDB Init] Collection 'projects' validator updated via collMod. ===");
  } catch (e) {
    print("=== [MongoDB Init Notice] collMod projects: " + e + " ===");
  }
}

safeCreateIndex(db.projects, { name: 1 }, { unique: true });
safeCreateIndex(db.projects, { created_at: -1 });
safeCreateIndex(db.projects, { updated_at: -1 });
safeCreateIndex(db.projects, { created_by: 1 });
safeCreateIndex(db.projects, { assigned_user_ids: 1 });
safeCreateIndex(db.projects, { "teams.member_ids": 1 });
safeCreateIndex(db.projects, { "teams.lead_id": 1 });
safeCreateIndex(db.projects, { controllers: 1 });
safeCreateIndex(db.projects, { status: 1 });

// ------------------------------------------------------------------------------
// 3. Notifications Collection & Indexes
// ------------------------------------------------------------------------------
if (!existingCols.includes("notifications")) {
  db.createCollection("notifications");
  print("=== [MongoDB Init] Collection 'notifications' created. ===");
}
safeCreateIndex(db.notifications, { created_at: -1 });
safeCreateIndex(db.notifications, { project_id: 1, created_at: -1 });
safeCreateIndex(db.notifications, { recipient_users: 1, created_at: -1 });
safeCreateIndex(db.notifications, { deleted_by: 1 });
safeCreateIndex(db.notifications, { read_by: 1 });
safeCreateIndex(db.notifications, { type: 1 });
safeCreateIndex(db.notifications, { to_all: 1 });
safeCreateIndex(db.notifications, { to_pm: 1 });
safeCreateIndex(db.notifications, { "data.requester_id": 1, "data.status": 1 });

// ------------------------------------------------------------------------------
// 4. Teams Collection (Reusable Library) & Indexes
// ------------------------------------------------------------------------------
if (!existingCols.includes("teams")) {
  db.createCollection("teams");
  print("=== [MongoDB Init] Collection 'teams' created. ===");
}
safeCreateIndex(db.teams, { name: 1, created_by: 1 });

print("=== [MongoDB Init] All required collections and indexes successfully initialized (empty). ===");
print("=== [MongoDB Init] Database is ready. Run populate_db.py to import sample data if needed. ===");
