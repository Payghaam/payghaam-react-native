import React, {useState} from 'react';
import {SafeAreaView, StatusBar, Text, Button, View, StyleSheet} from 'react-native';
import {Payghaam} from '@payghaam/react-native';

/** Minimal demo app showing Payghaam SDK initialization, login, and events. */
export default function App(): React.JSX.Element {
  const [initialized, setInitialized] = useState(false);
  const [status, setStatus] = useState('Tap Initialize to start');

  const initialize = async () => {
    await Payghaam.initialize({
      appId: 'YOUR_PROJECT_ID',
      apiKey: 'ek_client_...',
      baseUrl: 'https://api.yourhost.com',
      debug: true,
    });
    setInitialized(true);
    setStatus('SDK initialized');
  };

  const login = async () => {
    await Payghaam.login('example-user');
    setStatus('Logged in as example-user');
  };

  const trackEvent = async () => {
    await Payghaam.trackEvent('example_tap', {source: 'example_app'});
    setStatus('Tracked example_tap event');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.content}>
        <Text style={styles.status}>{status}</Text>
        <Button title="Initialize" onPress={initialize} />
        <View style={styles.spacer} />
        <Button title="Login" onPress={login} disabled={!initialized} />
        <View style={styles.spacer} />
        <Button title="Track event" onPress={trackEvent} disabled={!initialized} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  content: {flex: 1, padding: 24, justifyContent: 'center'},
  status: {marginBottom: 24, fontSize: 16},
  spacer: {height: 8},
});
