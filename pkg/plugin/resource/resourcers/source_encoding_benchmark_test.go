package resourcers

import (
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"google.golang.org/protobuf/proto"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

const sourceEncodingRecords = 256 // resource.MaxSourceBatchItems: one full snapshot page.

// convertBenchmarkObservation is the conversion Source applies to every informer
// object before handing it to the SDK emitter: the wire Value/record form plus
// the compact record and metadata.
func convertBenchmarkObservation(b *testing.B, u *unstructured.Unstructured) resource.SourceObservation {
	b.Helper()
	record, err := watchRecord(testWatchTarget(), testWatchRepresentation(), u)
	if err != nil {
		b.Fatal(err)
	}
	compact, err := compactWatchRecord(record, testWatchRepresentation())
	if err != nil {
		b.Fatal(err)
	}
	observation := resource.SourceObservation{Record: compact}
	metadata := extractMetadata(u)
	if len(metadata.Labels) != 0 || metadata.CreatedAt != nil {
		observation.Metadata = &metadata
	}
	return observation
}

// encodeBenchmarkSnapshot does what the SDK source emitter does for a snapshot
// page: size each observation, build its protobuf form, and marshal the frame.
func encodeBenchmarkSnapshot(b *testing.B, observations []resource.SourceObservation) int {
	b.Helper()
	snapshot := &resourcepb.SourceSnapshot{Observations: make([]*resourcepb.SourceObservation, 0, len(observations))}
	for _, observation := range observations {
		if _, err := resource.SourceObservationWireSize(observation); err != nil {
			b.Fatal(err)
		}
		encoded, err := resource.ToProtoSourceObservation(observation)
		if err != nil {
			b.Fatal(err)
		}
		snapshot.Observations = append(snapshot.Observations, encoded)
	}
	frame := &resourcepb.SourceFrame{Version: resource.WireVersion, SessionId: "bench-session", Generation: "bench-generation", Sequence: 1,
		Payload: &resourcepb.SourceFrame_Snapshot{Snapshot: snapshot}}
	wire, err := proto.Marshal(frame)
	if err != nil {
		b.Fatal(err)
	}
	if len(wire) > resource.MaxSourceFrameBytes {
		b.Fatalf("snapshot page is %d bytes, above the %d byte frame limit", len(wire), resource.MaxSourceFrameBytes)
	}
	return len(wire)
}

// encodeBenchmarkChange does what the emitter does for one live upsert event.
func encodeBenchmarkChange(b *testing.B, observation resource.SourceObservation) int {
	b.Helper()
	changes := resource.SourceChanges{Changes: []resource.SourceChange{{Kind: resource.SourceChangeUpsert, Observation: &observation}}}
	if _, err := resource.SourceChangesWireSize(changes); err != nil {
		b.Fatal(err)
	}
	encoded, err := resource.ToProtoSourceChanges(changes)
	if err != nil {
		b.Fatal(err)
	}
	frame := &resourcepb.SourceFrame{Version: resource.WireVersion, SessionId: "bench-session", Generation: "bench-generation", Sequence: 1,
		Payload: &resourcepb.SourceFrame_Changes{Changes: encoded}}
	wire, err := proto.Marshal(frame)
	if err != nil {
		b.Fatal(err)
	}
	return len(wire)
}

// BenchmarkSourceEncoding measures, for 256 representative Pods, the cost of
// turning informer objects into what the SDK emitter sends: a snapshot page and
// 256 single-change live events. Convert is the plugin side, Encode the SDK
// protobuf side, Total both.
func BenchmarkSourceEncoding(b *testing.B) {
	pods := make([]*unstructured.Unstructured, sourceEncodingRecords)
	for i := range pods {
		pods[i] = newRepresentativeBenchmarkPod(b, i)
	}
	observations := make([]resource.SourceObservation, len(pods))
	for i, pod := range pods {
		observations[i] = convertBenchmarkObservation(b, pod)
	}
	run := func(b *testing.B, work func() int) {
		b.ReportAllocs()
		b.ResetTimer()
		var wire int
		for range b.N {
			wire = work()
		}
		b.StopTimer()
		b.ReportMetric(sourceEncodingRecords, "records/op")
		if wire != 0 {
			b.ReportMetric(float64(wire), "wire-bytes/op")
		}
	}
	convertAll := func() {
		for _, pod := range pods {
			convertBenchmarkObservation(b, pod)
		}
	}
	b.Run("Snapshot256/Convert", func(b *testing.B) {
		run(b, func() int { convertAll(); return 0 })
	})
	b.Run("Snapshot256/Encode", func(b *testing.B) {
		run(b, func() int { return encodeBenchmarkSnapshot(b, observations) })
	})
	b.Run("Snapshot256/Total", func(b *testing.B) {
		run(b, func() int {
			page := make([]resource.SourceObservation, len(pods))
			for i, pod := range pods {
				page[i] = convertBenchmarkObservation(b, pod)
			}
			return encodeBenchmarkSnapshot(b, page)
		})
	})
	b.Run("Changes256/Encode", func(b *testing.B) {
		run(b, func() int {
			total := 0
			for _, observation := range observations {
				total += encodeBenchmarkChange(b, observation)
			}
			return total
		})
	})
	b.Run("Changes256/Total", func(b *testing.B) {
		run(b, func() int {
			total := 0
			for _, pod := range pods {
				total += encodeBenchmarkChange(b, convertBenchmarkObservation(b, pod))
			}
			return total
		})
	})
}
