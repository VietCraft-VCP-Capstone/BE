const mongoose = require('mongoose');
const fs = require('fs');

const mongoUri = 'mongodb+srv://nhibui07102023_db_user:PnyDSpS95LsHImQN@vietcraft.eupxy2t.mongodb.net/vietcraft?appName=VietCraft';

mongoose.connect(mongoUri)
    .then(async () => {
        const db = mongoose.connection.db;
        const users = await db.collection('users').find({}).toArray();
        let output = '--- ALL USERS IN DB ---\n';
        users.forEach(u => {
            output += `Email: ${u.email}, Role: ${u.role}, Full Name: ${u.full_name}\n`;
        });
        fs.writeFileSync('query_users_output.txt', output);
        process.exit(0);
    })
    .catch(err => {
        fs.writeFileSync('query_users_output.txt', 'Error: ' + err.stack);
        process.exit(1);
    });
