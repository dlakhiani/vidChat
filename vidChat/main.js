import './style.css'

import firebase from 'firebase/app';
import 'firebase/firestore';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBICgq7PthNQownOfWMpC8SH2Lg-6391KQ",
  authDomain: "vidchat-b53cc.firebaseapp.com",
  projectId: "vidchat-b53cc",
  storageBucket: "vidchat-b53cc.appspot.com",
  messagingSenderId: "436718064604",
  appId: "1:436718064604:web:36e3fa4ef319bdd0623519",
  measurementId: "G-T24N3WTLML"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const firestore = firebase.firestore();

//ice candidates for connections
const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

//Globals to share across STUN server
let pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

//initialize media 
webcamButton.onclick = async () => {
  console.log(navigator.mediaDevices);
  //promises -> objects
  localStream = await navigator.mediaDevices.getUserMedia({ 
    video: true, 
    audio: true 
  });
  remoteStream = new MediaStream();

  //update page
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  //listen to peer connections
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

//Connect calls = offers
callButton.onclick = async () => {

  //use firestore signalling
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id; //generate firestore id
  
  //save candidates to database
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  //create the offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  //save session-description-protocol to database
  await callDoc.set({ 
    offer 
  });

  //listen for changes in firestore to determine answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();

    //answer candidate is not occupied
    if (!pc.currentRemoteDescription && data?.answer) {

      //when answer is heard, create SDP
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  //add candidate to peer connections
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
  
  hangupButton.disabled = false;
};

// Answering calls
answerButton.onclick = async () => {

  //retrieve ID
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  //save candidate to database
  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  //create peer connection
  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  //generate description a local and set it as answer
  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    sdp: answerDescription.sdp,
    type: answerDescription.type,
  };

  //update SDP in database so streams can listen to one-another
  await callDoc.update({ 
    answer 
  });

  //add candidate to peer connection
  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });

  hangupButton.disabled = false;
};

//Ending the connection
hangupButton.onclick = async () => {
  remoteStream = null;
  pc.close();
};