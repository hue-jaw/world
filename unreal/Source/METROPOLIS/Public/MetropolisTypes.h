// ============================================================================
// METROPOLIS — MetropolisTypes.h
// Types partagés : réseau routier, GPS, météo, circulation, progression.
// Aucun état ici : uniquement des enums et des structures sérialisables.
// ============================================================================
#pragma once

#include "CoreMinimal.h"
#include "MetropolisTypes.generated.h"

/** Classe d'une voie. Sert au calcul d'itinéraire et au comportement du trafic. */
UENUM(BlueprintType)
enum class ERoadClass : uint8
{
	Street      UMETA(DisplayName = "Rue"),
	Avenue      UMETA(DisplayName = "Avenue"),
	Boulevard   UMETA(DisplayName = "Boulevard"),
	Highway     UMETA(DisplayName = "Autoroute"),
	Ramp        UMETA(DisplayName = "Bretelle"),
};

/** Mode de calcul d'itinéraire demandé par le joueur. */
UENUM(BlueprintType)
enum class ERouteMode : uint8
{
	Fastest     UMETA(DisplayName = "Le plus rapide"),
	Shortest    UMETA(DisplayName = "Le plus court"),
};

/** Manœuvre annoncée par le GPS. */
UENUM(BlueprintType)
enum class EGPSManeuver : uint8
{
	None,
	Straight,
	TurnLeft,
	TurnRight,
	SlightLeft,
	SlightRight,
	UTurn,
	Roundabout,
	Arrive,
};

/** État météorologique. Les transitions sont progressives (WeatherSubsystem). */
UENUM(BlueprintType)
enum class EWeatherState : uint8
{
	Clear,
	Cloudy,
	Overcast,
	LightRain,
	HeavyRain,
	Storm,
	Fog,
};

/** Profil de conduite appliqué aux véhicules IA. */
UENUM(BlueprintType)
enum class EDriverProfile : uint8
{
	Cautious,
	Normal,
	Aggressive,
	Sporty,
	Truck,
	Emergency,
};

/** Chapitre de l'histoire (repris de la v0.8 WebGL, comportement conservé). */
UENUM(BlueprintType)
enum class EStoryChapter : uint8
{
	Arrival     UMETA(DisplayName = "I — L'arrivée"),
	Job         UMETA(DisplayName = "II — Un boulot"),
	Home        UMETA(DisplayName = "III — Un toit"),
	Rise        UMETA(DisplayName = "IV — Faire sa place"),
};

/** Un nœud du graphe routier : une intersection (ou une extrémité). */
USTRUCT(BlueprintType)
struct FRoadNode
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	FVector Location = FVector::ZeroVector;

	/** Indices dans URoadNetworkSubsystem::Edges (sortants). */
	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	TArray<int32> Outgoing;

	/** Feu tricolore ? La phase est gérée par le sous-système. */
	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	bool bHasTrafficLight = false;

	/** 0 = rouge, 1 = orange, 2 = vert. */
	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	uint8 SignalPhase = 2;
};

/** Un tronçon orienté du graphe. */
USTRUCT(BlueprintType)
struct FRoadEdge
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	int32 From = INDEX_NONE;

	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	int32 To = INDEX_NONE;

	/** Longueur en centimètres. */
	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	float Length = 0.f;

	/** Vitesse légale en cm/s (13,9 m/s ≈ 50 km/h). */
	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	float SpeedLimit = 1390.f;

	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	ERoadClass Class = ERoadClass::Street;

	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	int32 Lanes = 2;

	UPROPERTY(BlueprintReadOnly, Category = "Réseau")
	bool bOneWay = false;

	/** Fermé (travaux, accident) : exclu du calcul d'itinéraire. */
	UPROPERTY(BlueprintReadOnly)
	bool bClosed = false;

	/** Coefficient de trafic [0..1] ajouté au coût (1 = bouchon). */
	UPROPERTY(BlueprintReadOnly)
	float Congestion = 0.f;
};

/** Manœuvre à venir, telle que l'affiche le HUD. */
USTRUCT(BlueprintType)
struct FGPSManeuver
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	EGPSManeuver Type = EGPSManeuver::None;

	/** Distance jusqu'à la manœuvre, en mètres. */
	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	float DistanceMeters = 0.f;

	/** Nom de la rue de destination (rempli par le niveau, optionnel). */
	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	FString StreetName;

	/** Cap à suivre après la manœuvre, en degrés [0..360). */
	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	float BearingAfter = 0.f;
};

/** Résultat d'un calcul d'itinéraire. */
USTRUCT(BlueprintType)
struct FGPSRoute
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	TArray<FVector> Points;

	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	double LengthMeters = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	double ETASeconds = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "GPS")
	bool bValid = false;
};
