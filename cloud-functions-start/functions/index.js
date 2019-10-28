/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// TODO(DEVELOPER): Import the Cloud Functions for Firebase and the Firebase Admin modules here.
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const Vision = require('@google-cloud/vision');
const vision = new Vision();
const spawn = require('child-process-promise').spawn;

const path = require('path');
const os = require('os');
const fs = require('fs');

admin.initializeApp();

// TODO(DEVELOPER): Write the addWelcomeMessages Function here.
exports.addWelcomeMessages = functions.auth.user().onCreate(async (user) => {
	console.log('A new user signed for the first time');
	const fullName = user.displayName || 'Anonymous';
	//save new message and display to clients
	await admin.firestore().collection('messages').add({
		name: 'Firebase Bot 👼', 
		profilePicUrl: '/images/firebase-logo.png',
		text: `${fullName} signed in for the first time! Welcome!`,
		timestamp: admin.firestore.FieldValue.serverTimestamp(),
	});
	console.log('Welcome message writtent to database.');
})

// TODO(DEVELOPER): Write the blurOffensiveImages Function here.
exports.blurOffensiveImages = functions.runWith({memory: '2GB'}).storage.object().onFinalize(
async (object) => {
	const image = {
		source: {imageUri: `gs://${object.bucket}/{object.name}`},
	};

	//** Vision API requires billing account** 
	// const Likelihood = Vision.types.Likelihood;
	// const batchAnnotateImagesResponse = await vision.safeSearchDetection(image);
	// const safeSearchResult = batchAnnotateImagesResponse[0].safeSearchAnnotation;	
	// if (Likelihood[safeSearchResult.adult] >= Likelihood.LIKELY || 
	// 	Likelihood[safeSearchResult.violence] >= Likelihood.LIKELY){

	//** blur all images**
	// if (true){
	// 	console.log('The image', object.name, 'has been detected as inappropiate.');
	// 	return blurImage(object.name);
	// }		
	console.log('The image', object.name, 'has been detected as OK');
});

async function blurImage(filePath) {
	const tempLocalFile = path.join(os.tmpdir(), path.basename(filePath));
	const messageId = filePath.split(path.sep)[1];
	const bucket = admin.storage().bucket();

	await bucket.file(filePath).download({destination: tempLocalFile});
	console.log('Image has been downloaded to', tempLocalFile);
	await spawn('convert', [tempLocalFile, '-channel' , 'RGBA', '-blur', '0x24', tempLocalFile]);
	console.log('Image has been blurred');
	await bucket.upload(tempLocalFile, {destination: filePath});
	console.log('Blurred image has been uploaded to', filePath);
	fs.unlinkSync(tempLocalFile);
	console.log('Deleted loca file');
	await admin.firestore().collection('message').doc(messageId).update({moderated: true});
	console.log('Marked the image as moderated in the database');
}

// TODO(DEVELOPER): Write the sendNotifications Function here.
exports.sendNotifications = functions.firestore.document('messages/{messageId}').onCreate(


	async (snapshot) => {

		console.log('notifications pipeline started');
		const text = snapshot.data().text;
		const payload = {
			notification: {
				title: `${snapshot.data().name} posted ${text ? 'a message' : 'an image'}`,
				body: text ? (text.length <= 100 ? text : text.substring(0, 97) + '...') : '', 
				icon: snapshot.data().profilePicUrl || 'images/profile_placeholder.png',
				click_action: `https://${process.env.GCLOUD_PROJECT}.firebaseapp.com`,
			}
		}
		//device tokens
		const allTokens = await admin.firestore().collection('fcmTokens').get();
		const tokens = [];
		allTokens.forEach((tokenDoc) => {
			tokens.push(tokenDoc.id);
		});

		if(tokens.length > 0){
			const response = await admin.messaging().sendToDevice(tokens, payload);
			await cleanupTokens(response, tokens);
			console.log('notifications have been sent and tokens cleaned up.');
		}

	});

function cleanupTokens(response, tokens){
	const tokensDelete = [];
	response.results.forEach((result, index) => {
		const error = result.error;
		if (error){
			console.error('Fail to send notif', tokens[index], error);

			if (error.code === 'messaging/invalid-registration-token' ||
				error.code === 'messaging/registration-token-not-registered'){
				const deleteTask = admin.firestore().collection('messages').doc(tokens[index]).delete();
				tokensDelete.push(deleteTask);			
			}
		}
	});
	return Promise.all(tokensDelete);
}
