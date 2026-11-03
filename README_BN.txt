FFX TOPUP — Manual bKash/Nagad Wallet Add Money

এই প্যাকেজে আছে:
- server.js: Express + PostgreSQL API
- FFX.html: মূল সাইট (পুরোনো ডিজাইন রেখে Sign In/Sign Up ও Add Money যুক্ত)
- wallet.js: লগইন ও Add Money ফ্রন্টএন্ড
- admin.html: Admin Panel (/admin)
- package.json: প্রয়োজনীয় Node dependencies
- generate-admin-hash.js: Admin password hash ও session secret তৈরির helper

Render-এ আপডেটের আগে ব্যাকআপ রাখবেন। প্রথমে staging/test service-এ পরীক্ষা করা উত্তম।

Render Environment Variables:
1) DATABASE_URL = আপনার Render PostgreSQL Internal Database URL
2) NODE_ENV = production
3) ADMIN_USER = আপনার পছন্দের Admin username
4) ADMIN_PASSWORD_HASH = generate-admin-hash.js চালিয়ে পাওয়া bcrypt hash
5) SESSION_SECRET = একই স্ক্রিপ্টে পাওয়া দীর্ঘ random secret

Admin hash তৈরি:
- নিজের কম্পিউটারে এই প্রজেক্টের ফোল্ডারে npm install চালান
- node generate-admin-hash.js চালান
- স্ক্রিপ্টে একটি আলাদা, শক্তিশালী Admin password টাইপ করুন (টাইপ করা দেখা যাবে না)
- আউটপুটের ADMIN_PASSWORD_HASH ও SESSION_SECRET Render Environment-এ বসান
- পাসওয়ার্ড/হ্যাশ/SESSION_SECRET কাউকে পাঠাবেন না

ফাইল বসানো:
- server.js, package.json, FFX.html, wallet.js, admin.html একই প্রজেক্ট root-এ রাখুন
- generate-admin-hash.js শুধু লোকাল মেশিনে চালাবেন; Render-এ আপলোডের দরকার নেই
- Render deploy করুন
- https://আপনার-সাইট/admin খুলে Admin username/password দিয়ে ঢুকুন
- Payment Numbers-এ bKash ও Nagad নম্বর বসিয়ে Save Numbers চাপুন

ব্যবহার:
- ইউজার Sign In / Sign Up করবে
- Add Money-তে নম্বর দেখে টাকা পাঠাবে এবং পরিমাণ, পদ্ধতি, প্রেরকের নম্বর, TrxID জমা দেবে
- Admin নিজে পেমেন্ট অ্যাকাউন্টে টাকা এসেছে কিনা যাচাই করে Approve করবে
- কেবল Approve হলে PostgreSQL transaction-এর মাধ্যমে wallet balance একবার যোগ হবে
- একই TrxID দ্বিতীয়বার জমা দেওয়া যাবে না

সতর্কতা:
- এটি ম্যানুয়াল যাচাই ব্যবস্থা; bKash/Nagad থেকে স্বয়ংক্রিয়ভাবে টাকা যাচাই করে না
- শুধু টাকা সত্যিই পাওয়ার পর Approve করবেন
- সাধারণ ব্যক্তিগত নম্বর দিয়ে বাণিজ্যিক পেমেন্ট নেওয়ার আগে সংশ্লিষ্ট সেবার শর্ত ও অভিভাবকের সহায়তা নিন
- bKash/Nagad PIN, OTP, password বা API secret ওয়েবসাইটের HTML-এ রাখবেন না
- এই প্যাকেজে পুরোনো Top-up order submission/payment deduction backend তৈরি করা হয়নি; শুধু account, wallet deposit request ও admin review যুক্ত হয়েছে
